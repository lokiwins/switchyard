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

test('github.issueRepos: which repos the GitHub issues list shows, as owner/repo; empty shows them all', () => {
  assert.deepEqual(parseSettings({}).github.issueRepos, []);
  assert.deepEqual(parseSettings({ github: { issueRepos: ['acme/storefront', 'Acme/Billing-API'] } }).github.issueRepos, ['acme/storefront', 'Acme/Billing-API']);
  for (const bad of [['storefront'], ['acme/store front'], ['a/b/c'], 'acme/storefront', [''], [3]]) {
    assert.throws(() => parseSettings({ github: { issueRepos: bad } }), /github\.issueRepos/, JSON.stringify(bad));
  }
});

test('done tasks are kept unless you turn on deleting them, after a number of days', () => {
  assert.deepEqual(parseSettings({}).tasks, { autoDeleteDone: false, deleteDoneAfterMs: 7 * 86_400_000 });
  assert.deepEqual(parseSettings({ tasks: { autoDeleteDone: true, deleteDoneAfterDays: 0.5 } }).tasks, { autoDeleteDone: true, deleteDoneAfterMs: 43_200_000 });
  assert.throws(() => parseSettings({ tasks: { autoDeleteDone: 'yes' } }), /tasks.autoDeleteDone/);
  assert.throws(() => parseSettings({ tasks: { deleteDoneAfterDays: 0 } }), /tasks.deleteDoneAfterDays/);
});

test('providers: Claude Code is on and the default, running claude with no extra options', () => {
  assert.deepEqual(parseSettings({}).providers, { default: 'claude', claude: { enabled: true, program: 'claude', options: [] } });
});

test('providers: a program path and extra options, split into words; settings left out keep their defaults', () => {
  const providers = parseSettings({ providers: { claude: { program: '~/.local/bin/claude', options: '  --model opus   --permission-mode acceptEdits ' } } }).providers;
  assert.deepEqual(providers.claude, { enabled: true, program: '~/.local/bin/claude', options: ['--model', 'opus', '--permission-mode', 'acceptEdits'] });
  assert.equal(parseSettings({ providers: { claude: { program: '/opt/tools/claude-2.1' } } }).providers.claude.program, '/opt/tools/claude-2.1');
});

test('providers: a program is a bare name or a full path; nothing a shell would read as more than a program', () => {
  for (const program of ['', 'claude --model x', 'bin/claude', '-claude', 'claude;rm', '$(claude)', '/my tools/claude', '~user/claude', 42]) {
    assert.throws(() => parseSettings({ providers: { claude: { program } } }), (e) => e instanceof SettingsError && /providers\.claude\.program/.test(e.message), String(program));
  }
});

test('providers: options are plain words, no quotes or shell syntax', () => {
  for (const options of ["--append-system-prompt 'be brief'", '--model "opus"', '--x $HOME', '--a; rm -rf ~', '--a | tee', '`x`', 'a\nb', 42]) {
    assert.throws(() => parseSettings({ providers: { claude: { options } } }), (e) => e instanceof SettingsError && /providers\.claude\.options/.test(e.message), String(options));
  }
  assert.throws(() => parseSettings({ providers: { claude: { options: `--x ${'y'.repeat(600)}` } } }), /providers\.claude\.options/);
});

test('providers: the default is a provider that is turned on; unknown providers and keys are refused', () => {
  assert.throws(() => parseSettings({ providers: { default: 'codex' } }), /providers\.default/);
  assert.throws(() => parseSettings({ providers: { claude: { enabled: false } } }), /providers\.default.*turned off|turned off/);
  assert.throws(() => parseSettings({ providers: { claude: { enabled: 'no' } } }), /providers\.claude\.enabled/);
  assert.throws(() => parseSettings({ providers: { codex: { enabled: true } } }), /providers\.codex/);
  assert.throws(() => parseSettings({ providers: { claude: { model: 'opus' } } }), /providers\.claude\.model/);
  assert.throws(() => parseSettings({ providers: { claude: 'on' } }), /providers\.claude/);
});

test('checks: none by default, with a 10 minute timeout', () => {
  assert.deepEqual(parseSettings({}).checks, { commands: {}, timeoutMs: 10 * 60 * 1000 });
});

test('checks: named checks per repo, in the order written', () => {
  const checks = parseSettings({ checks: { commands: { 'billing-api': { lint: 'npm run lint', test: 'npm test' }, storefront: { test: ' npm test ' } }, timeoutMinutes: 2.5 } }).checks;
  assert.deepEqual(checks.commands, {
    'billing-api': [{ name: 'lint', command: 'npm run lint', run: 'manual', timeoutMs: null }, { name: 'test', command: 'npm test', run: 'manual', timeoutMs: null }],
    storefront: [{ name: 'test', command: 'npm test', run: 'manual', timeoutMs: null }],
  });
  assert.equal(checks.timeoutMs, 150_000);
});

test('checks: a repo given just a command has one check called "check"; the earlier "repo: command" lines still work', () => {
  assert.deepEqual(parseSettings({ checks: { commands: { storefront: 'npm test' } } }).checks.commands, { storefront: [{ name: 'check', command: 'npm test', run: 'manual', timeoutMs: null }] });
  assert.deepEqual(parseSettings({ checks: { commands: ['billing-api: npm run lint && npm test'] } }).checks.commands, { 'billing-api': [{ name: 'check', command: 'npm run lint && npm test', run: 'manual', timeoutMs: null }] });
});

test('checks: bad repo or check names, empty or overlong commands, too many checks, or a bad timeout are refused', () => {
  const refused = [
    { 'my repo': { test: 'x' } }, { a: { 'my check': 'x' } }, { a: { test: '' } }, { a: { test: '   ' } }, { a: { test: 42 } }, { a: { test: null } },
    { a: ['x'] }, { a: {} }, { a: { test: 'x'.repeat(2001) } }, { a: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`c${i}`, 'x'])) },
    'npm test', ['npm test'], ['a: x', 'a: y'],
  ];
  for (const commands of refused) {
    assert.throws(() => parseSettings({ checks: { commands } }), (e) => e instanceof SettingsError && /checks\.commands/.test(e.message), JSON.stringify(commands).slice(0, 80));
  }
  assert.throws(() => parseSettings({ checks: { timeoutMinutes: 0 } }), /checks\.timeoutMinutes/);
  assert.throws(() => parseSettings({ checks: { timeoutMinutes: 121 } }), /checks\.timeoutMinutes/);
});

test('checks: a check can say when it runs by itself, and its own timeout', () => {
  const commands = parseSettings({ checks: { commands: { 'billing-api': {
    lint: { command: 'npm run lint', run: 'after-turn' },
    test: { command: 'npm test', run: 'on-commit', timeout: 20 },
    e2e: { command: 'npm run e2e', timeout: 0.5 },
  } } } }).checks.commands['billing-api'];
  assert.deepEqual(commands, [
    { name: 'lint', command: 'npm run lint', run: 'after-turn', timeoutMs: null },
    { name: 'test', command: 'npm test', run: 'on-commit', timeoutMs: 20 * 60 * 1000 },
    { name: 'e2e', command: 'npm run e2e', run: 'manual', timeoutMs: 30 * 1000 },
  ]);
});

test('checks: an unknown "run", a bad timeout, an unknown option or no command is refused, naming the check', () => {
  const refused = [
    { command: 'x', run: 'always' }, { command: 'x', run: true }, { command: 'x', timeout: 0 }, { command: 'x', timeout: 121 }, { command: 'x', timeout: '5' },
    { command: 'x', every: 5 }, { run: 'after-turn' }, { command: '' },
  ];
  for (const check of refused) {
    assert.throws(() => parseSettings({ checks: { commands: { 'billing-api': { test: check } } } }), (e) => e instanceof SettingsError && /checks\.commands/.test(e.message) && /billing-api test/.test(e.message), JSON.stringify(check));
  }
});

test('workers: the permission mode a lead\'s workers start in, and the tools they may use without asking', () => {
  // By default nothing changes: workers start as Claude would.
  assert.deepEqual(parseSettings({}).workers, { permissionMode: 'claude', allowedTools: [] });
  assert.deepEqual(parseSettings({ workers: { permissionMode: 'acceptEdits', allowedTools: ['Bash(npm test)', 'Edit', 'mcp__github__get_issue', 'Bash(git log:*)'] } }).workers,
    { permissionMode: 'acceptEdits', allowedTools: ['Bash(npm test)', 'Edit', 'mcp__github__get_issue', 'Bash(git log:*)'] });
  for (const mode of ['manual', 'plan', 'auto']) assert.equal(parseSettings({ workers: { permissionMode: mode } }).workers.permissionMode, mode);
  // Never a mode that skips your say altogether.
  for (const bad of ['bypassPermissions', 'dontAsk', 'yolo', '']) assert.throws(() => parseSettings({ workers: { permissionMode: bad } }), /workers.permissionMode/, bad);
  for (const bad of [['Bash(rm -rf /'], ['two words'], ['Bash(a)(b)'], [''], ['x'.repeat(400)], 'Edit']) {
    assert.throws(() => parseSettings({ workers: { allowedTools: bad } }), /workers.allowedTools/, JSON.stringify(bad));
  }
});

test('the old "lead without asking" switch in a config file is ignored, not an error: a lead never asks now', () => {
  for (const old of [true, false]) assert.deepEqual(parseSettings({ workers: { leadWithoutAsking: old } }).workers, { permissionMode: 'claude', allowedTools: [] });
});

test('agents.maxRunning: how many agents may run at once; 0 is no limit', () => {
  assert.equal(parseSettings({}).agents.maxRunning, 0);
  assert.equal(parseSettings({ agents: { maxRunning: 6 } }).agents.maxRunning, 6);
  for (const bad of [-1, 2.5, '6', 1000]) assert.throws(() => parseSettings({ agents: { maxRunning: bad } }), /agents.maxRunning/, String(bad));
});

test('agents.stuckAfterMinutes and agents.contextAlertTokens: when a session is flagged as stuck, or too full; 0 turns each off', () => {
  const { agents } = parseSettings({});
  assert.equal(agents.stuckAfterMs, 30 * 60_000);
  assert.equal(agents.contextAlertTokens, 0);
  const set = parseSettings({ agents: { stuckAfterMinutes: 0, contextAlertTokens: 150000 } }).agents;
  assert.equal(set.stuckAfterMs, 0);
  assert.equal(set.contextAlertTokens, 150000);
  for (const bad of [-1, 'soon']) assert.throws(() => parseSettings({ agents: { stuckAfterMinutes: bad } }), /agents.stuckAfterMinutes/);
  for (const bad of [-5, 1.5, '1k']) assert.throws(() => parseSettings({ agents: { contextAlertTokens: bad } }), /agents.contextAlertTokens/);
});

test('prReview.instructions: the PR review agent\'s instructions, your senior-engineer review by default', () => {
  assert.match(DEFAULT_SETTINGS.prReview.instructions, /^You are a senior software engineer reviewing a pull request/);
  const own = 'Review {{pr.url}} for security only.';
  assert.equal(parseSettings({ prReview: { instructions: own } }).prReview.instructions, own);
});

test('prReview.instructions: empty, overlong, or with a placeholder switchyard can\'t fill, is refused', () => {
  for (const [instructions, message] of [
    ['  ', /"prReview.instructions" must be/],
    [42, /"prReview.instructions" must be/],
    ['x'.repeat(20_001), /"prReview.instructions" must be/],
    ['Review {{pr.title}} with {{pr.labels}}', /"prReview.instructions" has \{\{pr.labels\}\}, which switchyard doesn't fill/],
  ]) {
    assert.throws(() => parseSettings({ prReview: { instructions } }), (error) => error instanceof SettingsError && message.test(error.message), String(instructions).slice(0, 20));
  }
});
