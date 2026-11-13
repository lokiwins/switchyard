import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editsFromFields, fieldsFromValues } from '../public/settings-form.js';

const VALUES = {
  roots: ['~/work', '~/code'],
  terminal: { app: 'iTerm' },
  editor: { urlScheme: 'cursor' },
  agents: { parkedAfterHours: 24, endedHistoryDays: 7, interruptedAttentionDays: 3 },
  github: { copilotReviewer: 'copilot-pull-request-reviewer[bot]' },
  git: { longLivedBranches: ['main', 'release/*'] },
  ci: { holdPatterns: ['\\bhold\\b'], stripPrefixes: ['ci/circleci: '] },
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
