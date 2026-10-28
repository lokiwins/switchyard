import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCopilotLogin, summarizeChecks } from '../src/github.js';
import { copilotStatus } from '../src/prs.js';
import { DEFAULT_SETTINGS, SettingsError, branchMatcher, parseSettings } from '../src/settings.js';
import { deriveFlags, isParked, matchPr } from '../src/state.js';

const HOUR = 60 * 60 * 1000;
const pending = (context) => ({ __typename: 'StatusContext', context, state: 'PENDING' });

test('no config file gives the built-in defaults', () => {
  const settings = parseSettings({});
  assert.equal(settings.agents.parkedAfterMs, 24 * HOUR);
  assert.equal(settings.agents.endedHistoryMs, 7 * 24 * HOUR);
  assert.equal(settings.agents.interruptedAttentionMs, 3 * 24 * HOUR);
  assert.equal(settings.github.copilotReviewer, 'copilot-pull-request-reviewer[bot]');
  assert.deepEqual(settings.ci.stripPrefixes, ['ci/circleci: ']);
  assert.equal(settings.git.isLongLivedBranch('main'), true);
  assert.equal(settings.git.isLongLivedBranch('feature/x'), false);
});

test('custom hold patterns decide which pending workflows count as held', () => {
  const ci = parseSettings({ ci: { holdPatterns: ['^Gate: '] } }).ci;
  const rollup = [pending('ci/deploy/Gate: prod'), pending('ci/deploy/smoke'), pending('ci/other/deploy_hold')];

  const summary = summarizeChecks(rollup, ci);

  assert.equal(summary.heldCount, 2);
  assert.deepEqual(summary.running.map((c) => c.name), ['ci/other/deploy_hold']);
});

test('strip prefixes shorten check labels but keep the full name', () => {
  const ci = parseSettings({ ci: { stripPrefixes: ['buildkite/acme/', 'ci/circleci: '] } }).ci;
  const [check] = summarizeChecks([{ __typename: 'StatusContext', context: 'buildkite/acme/lint', state: 'FAILURE' }], ci).failed;
  assert.equal(check.name, 'buildkite/acme/lint');
  assert.equal(check.label, 'lint');
});

test('long-lived branches support "*" wildcards and are never matched to PRs', () => {
  const { isLongLivedBranch } = parseSettings({ git: { longLivedBranches: ['main', 'release/*'] } }).git;
  const prs = [{ number: 1, headRefName: 'release/2026.10', state: 'OPEN', updatedAt: '2026-01-01' }];

  assert.equal(matchPr(prs, 'release/2026.10', isLongLivedBranch), null);
  assert.equal(matchPr(prs, 'release/2026.10').number, 1);
  assert.equal(branchMatcher(['release/*'])('releases/x'), false);
  assert.equal(branchMatcher(['a.b'])('aXb'), false);
});

test('a custom Copilot reviewer login is matched with or without the [bot] suffix', () => {
  const reviewer = parseSettings({ github: { copilotReviewer: 'acme-copilot[bot]' } }).github.copilotReviewer;
  assert.equal(isCopilotLogin('acme-copilot', reviewer), true);
  assert.equal(isCopilotLogin('copilot-pull-request-reviewer', reviewer), false);
  assert.deepEqual(
    copilotStatus({ reviews: [{ login: 'acme-copilot', submittedAt: 't' }], requested: [] }, reviewer),
    { requested: false, lastReviewedAt: 't' },
  );
});

test('agent timings are configurable in hours and days', () => {
  const agents = parseSettings({ agents: { parkedAfterHours: 2, interruptedAttentionDays: 0.5 } }).agents;
  const now = 100 * HOUR;
  const idle = { status: 'idle', statusUpdatedAt: now - 3 * HOUR };
  assert.equal(isParked(idle, now, agents.parkedAfterMs), true);
  assert.equal(isParked(idle, now), false);

  const interrupted = { updatedAt: now - 13 * HOUR, transcript: { endState: 'interrupted' } };
  const input = { isMain: false, status: null, pr: null, liveSessions: [], lastSession: interrupted };
  assert.deepEqual(deriveFlags(input, now, agents), []);
  assert.deepEqual(deriveFlags(input, now, DEFAULT_SETTINGS.agents), ['agent-interrupted']);
});

test('invalid settings fail with a message naming the exact key', () => {
  const cases = [
    [{ ci: { holdPattern: ['x'] } }, /"ci.holdPattern" is not a known setting/],
    [{ agent: {} }, /"agent" is not a known setting/],
    [{ ci: { holdPatterns: ['ok', '(unclosed'] } }, /"ci.holdPatterns\[1\]" is not a valid regular expression/],
    [{ ci: { stripPrefixes: 'ci/' } }, /"ci.stripPrefixes" must be an array of non-empty strings/],
    [{ agents: { parkedAfterHours: 0 } }, /"agents.parkedAfterHours" must be a positive number/],
    [{ github: { copilotReviewer: '' } }, /"github.copilotReviewer" must be a non-empty string/],
    [{ git: [] }, /"git" must be an object/],
    [{ port: '4477' }, /"port" must be a positive integer/],
    [{ roots: '~/work' }, /"roots" must be an array/],
  ];
  for (const [file, message] of cases) {
    assert.throws(() => parseSettings(file), (error) => error instanceof SettingsError && message.test(error.message));
  }
});

test('terminal and editor settings validate and resolve', async () => {
  const { resolveTerminalApp } = await import('../src/settings.js');
  assert.equal(parseSettings({}).terminal.app, 'auto');
  assert.equal(parseSettings({ editor: { urlScheme: 'none' } }).editor.urlScheme, null);
  assert.equal(parseSettings({ editor: { urlScheme: 'cursor' } }).editor.urlScheme, 'cursor');
  assert.throws(() => parseSettings({ terminal: { app: 'Konsole' } }), /"terminal.app" must be one of/);
  assert.throws(() => parseSettings({ editor: { urlScheme: 'javascript:alert(1)//' } }), /"editor.urlScheme" must be a URL scheme/);
  assert.equal(resolveTerminalApp('auto', { TERM_PROGRAM: 'iTerm.app' }), 'iTerm');
  assert.equal(resolveTerminalApp('auto', { TERM_PROGRAM: 'vscode' }), 'Terminal');
  assert.equal(resolveTerminalApp('none'), null);
  assert.equal(resolveTerminalApp('Terminal'), 'Terminal');
});
