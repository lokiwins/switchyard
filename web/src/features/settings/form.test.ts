import { expect, test } from 'vitest';
import { editableSettings } from '../../../../src/settings-file.js';
import { editsFromFields as toEdits, FIELD_NAMES, fieldsFromValues, type Fields } from './form';

/** Settings as nested objects, as the form sends them; read here a level or two in. */
interface Tree { [key: string]: Tree }
const editsFromFields = (fields: Fields) => toEdits(fields) as unknown as Tree;

const VALUES = {
  roots: ['~/work', '~/code'],
  appearance: { theme: 'signal', mode: 'system', terminal: 'nord' },
  terminal: { app: 'iTerm' },
  editor: { urlScheme: 'cursor' },
  agents: { parkedAfterHours: 24, endedHistoryDays: 7, interruptedAttentionDays: 3, maxRunning: 6, stuckAfterMinutes: 30, contextAlertTokens: 150000 },
  github: { copilotReviewer: 'copilot-pull-request-reviewer[bot]', issueRepos: ['acme/storefront'] },
  git: { longLivedBranches: ['main', 'release/*'] },
  ci: { holdPatterns: ['\\bhold\\b'], stripPrefixes: ['ci/circleci: '] },
  tasks: { autoDeleteDone: true, deleteDoneAfterDays: 14 },
  workers: { permissionMode: 'acceptEdits', allowedTools: ['Bash(npm test)', 'Edit'] },
  providers: { default: 'claude', claude: { enabled: true, program: 'claude', options: '' } },
  checks: { commands: 'billing-api:\n  test: npm test', timeoutMinutes: 10 },
};

test('each setting becomes a form field: lists one item per line, numbers as text', () => {
  const fields = fieldsFromValues(VALUES);
  expect(fields.roots).toBe('~/work\n~/code');
  expect(fields['terminal.app']).toBe('iTerm');
  expect(fields['agents.parkedAfterHours']).toBe('24');
  expect(fields['git.longLivedBranches']).toBe('main\nrelease/*');
  expect(fields['ci.stripPrefixes']).toBe('ci/circleci: ');
});

test('the form reads back as the same settings', () => {
  expect(editsFromFields(fieldsFromValues(VALUES))).toStrictEqual(VALUES);
});

test('lists drop blank lines and trim, except prefixes, whose trailing space is part of what\'s removed', () => {
  const edits = editsFromFields({ ...fieldsFromValues(VALUES), roots: ' ~/work \n\n', 'git.longLivedBranches': 'main\n  \n dev ', 'ci.stripPrefixes': 'ci/circleci: \n\nci/: ' });
  expect(edits.roots).toStrictEqual(['~/work']);
  expect(edits.git?.longLivedBranches).toStrictEqual(['main', 'dev']);
  expect(edits.ci?.stripPrefixes).toStrictEqual(['ci/circleci: ', 'ci/: ']);
});

test('numbers are read as numbers; one that isn\'t a number is sent as written, for the server to refuse', () => {
  const edits = editsFromFields({ ...fieldsFromValues(VALUES), 'agents.parkedAfterHours': ' 1.5 ', 'agents.endedHistoryDays': 'soon' });
  expect(edits.agents?.parkedAfterHours).toBe(1.5);
  expect(edits.agents?.endedHistoryDays).toBe('soon');
});

test('a yes-or-no setting is a checkbox field: "true" or "false", read back as a boolean', () => {
  const fields = fieldsFromValues(VALUES);
  expect(fields['tasks.autoDeleteDone']).toBe('true');
  expect(fields['tasks.deleteDoneAfterDays']).toBe('14');
  expect(editsFromFields({ ...fields, 'tasks.autoDeleteDone': 'false' }).tasks?.autoDeleteDone).toBe(false);
  expect(editsFromFields(fields).tasks).toStrictEqual({ autoDeleteDone: true, deleteDoneAfterDays: 14 });
});

test('a provider\'s settings are fields one level further in: on or off, program, and options as typed', () => {
  const values = { ...VALUES, providers: { default: 'claude', claude: { enabled: true, program: 'claude', options: '--model opus' } } };
  const fields = fieldsFromValues(values);
  expect(fields['providers.default']).toBe('claude');
  expect(fields['providers.claude.enabled']).toBe('true');
  expect(fields['providers.claude.program']).toBe('claude');
  expect(fields['providers.claude.options']).toBe('--model opus');
  expect(editsFromFields(fields).providers).toStrictEqual(values.providers);
  expect(editsFromFields({ ...fields, 'providers.claude.options': '  --model sonnet ' }).providers?.claude?.options).toBe('--model sonnet');
});

test('Workers: allowed tools one per line', () => {
  const fields = fieldsFromValues(VALUES);
  expect(fields['workers.allowedTools']).toBe('Bash(npm test)\nEdit');
  expect('workers.leadWithoutAsking' in fields).toBe(false);
  const edits = editsFromFields({ ...fields, 'workers.allowedTools': ' Read \n\nBash(npm run lint)' });
  expect(edits.workers).toStrictEqual({ permissionMode: 'acceptEdits', allowedTools: ['Read', 'Bash(npm run lint)'] });
});

test('the appearance has its fields, and reads back as it was', () => {
  expect(FIELD_NAMES).toEqual(expect.arrayContaining(['appearance.theme', 'appearance.mode', 'appearance.terminal']));
  const appearance = { theme: 'dusk', mode: 'light', terminal: 'one-dark' };
  expect(editsFromFields(fieldsFromValues({ ...VALUES, appearance })).appearance).toStrictEqual(appearance);
});

test('the form has a field for every setting the server lets the page edit, and reads each back as the server gave it', () => {
  const values = { ...editableSettings({}), roots: ['~/work'] };
  expect(toEdits(fieldsFromValues(values))).toStrictEqual(values);
});
