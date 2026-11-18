import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editsFromFields, fieldsFromValues } from '../public/settings-form.js';

const VALUES = {
  roots: ['~/work', '~/code'],
  appearance: { theme: 'signal', mode: 'system', terminal: 'nord' },
  terminal: { app: 'iTerm' },
  editor: { urlScheme: 'cursor' },
  agents: { parkedAfterHours: 24, endedHistoryDays: 7, interruptedAttentionDays: 3 },
  github: { copilotReviewer: 'copilot-pull-request-reviewer[bot]', issueRepos: ['acme/storefront'] },
  git: { longLivedBranches: ['main', 'release/*'] },
  ci: { holdPatterns: ['\\bhold\\b'], stripPrefixes: ['ci/circleci: '] },
  tasks: { autoDeleteDone: true, deleteDoneAfterDays: 14 },
  providers: { default: 'claude', claude: { enabled: true, program: 'claude', options: '' } },
  checks: { commands: 'billing-api:\n  test: npm test', timeoutMinutes: 10 },
};

test('each setting becomes a form field: lists one item per line, numbers as text', () => {
  const fields = fieldsFromValues(VALUES);
  assert.equal(fields.roots, '~/work\n~/code');
  assert.equal(fields['terminal.app'], 'iTerm');
  assert.equal(fields['agents.parkedAfterHours'], '24');
  assert.equal(fields['git.longLivedBranches'], 'main\nrelease/*');
  assert.equal(fields['ci.stripPrefixes'], 'ci/circleci: ');
});

test('the form reads back as the same settings', () => {
  assert.deepEqual(editsFromFields(fieldsFromValues(VALUES)), VALUES);
});

test('lists drop blank lines and trim, except prefixes, whose trailing space is part of what\'s removed', () => {
  const edits = editsFromFields({ ...fieldsFromValues(VALUES), roots: ' ~/work \n\n', 'git.longLivedBranches': 'main\n  \n dev ', 'ci.stripPrefixes': 'ci/circleci: \n\nci/: ' });
  assert.deepEqual(edits.roots, ['~/work']);
  assert.deepEqual(edits.git.longLivedBranches, ['main', 'dev']);
  assert.deepEqual(edits.ci.stripPrefixes, ['ci/circleci: ', 'ci/: ']);
});

test('numbers are read as numbers; one that isn\'t a number is sent as written, for the server to refuse', () => {
  const edits = editsFromFields({ ...fieldsFromValues(VALUES), 'agents.parkedAfterHours': ' 1.5 ', 'agents.endedHistoryDays': 'soon' });
  assert.equal(edits.agents.parkedAfterHours, 1.5);
  assert.equal(edits.agents.endedHistoryDays, 'soon');
});

test('a yes-or-no setting is a checkbox field: "true" or "false", read back as a boolean', () => {
  const fields = fieldsFromValues(VALUES);
  assert.equal(fields['tasks.autoDeleteDone'], 'true');
  assert.equal(fields['tasks.deleteDoneAfterDays'], '14');
  assert.equal(editsFromFields({ ...fields, 'tasks.autoDeleteDone': 'false' }).tasks.autoDeleteDone, false);
  assert.deepEqual(editsFromFields(fields).tasks, { autoDeleteDone: true, deleteDoneAfterDays: 14 });
});

test('a provider\'s settings are fields one level further in: on or off, program, and options as typed', () => {
  const values = { ...VALUES, providers: { default: 'claude', claude: { enabled: true, program: 'claude', options: '--model opus' } } };
  const fields = fieldsFromValues(values);
  assert.equal(fields['providers.default'], 'claude');
  assert.equal(fields['providers.claude.enabled'], 'true');
  assert.equal(fields['providers.claude.program'], 'claude');
  assert.equal(fields['providers.claude.options'], '--model opus');
  assert.deepEqual(editsFromFields(fields).providers, values.providers);
  assert.equal(editsFromFields({ ...fields, 'providers.claude.options': '  --model sonnet ' }).providers.claude.options, '--model sonnet');
});
