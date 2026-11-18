import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCompare, changeSummary, commitSummary, contextSummary, fileLine, stateLabel,
} from '../public/attempt-cards.js';

test('an attempt\'s session state reads as a word', () => {
  assert.deepEqual(['working', 'needs-you', 'idle', 'not-running', 'other'].map(stateLabel), ['Working', 'Needs you', 'Idle', 'Not running', '']);
});

test('what an attempt changed: files and lines, new files counted apart; none yet; or unknown', () => {
  const changes = {
    files: [{ path: 'a.js', added: 10, removed: 2 }, { path: 'b.png', added: null, removed: null }, { path: 'c.md', added: null, removed: null, untracked: true }],
    added: 10, removed: 2,
  };
  assert.equal(changeSummary(changes), '3 files · +10 −2 · 1 new');
  assert.equal(changeSummary({ files: [{ path: 'a.js', added: 1, removed: 0 }], added: 1, removed: 0 }), '1 file · +1 −0');
  assert.equal(changeSummary({ files: [], added: 0, removed: 0 }), 'No changes yet');
  assert.equal(changeSummary(null), 'Changes unknown');
});

test('commits, context and each file, as short lines', () => {
  assert.equal(commitSummary(1), '1 commit');
  assert.equal(commitSummary(3), '3 commits');
  assert.equal(commitSummary(0), 'No commits yet');
  assert.equal(commitSummary(null), null);
  assert.equal(contextSummary(31000), '31k tokens in context');
  assert.equal(contextSummary(null), null);
  assert.equal(fileLine({ path: 'a.js', added: 10, removed: 2 }), '+10 −2  a.js');
  assert.equal(fileLine({ path: 'b.png', added: null, removed: null }), 'binary  b.png');
  assert.equal(fileLine({ path: 'c.md', added: null, removed: null, untracked: true }), 'new  c.md');
});

test('a task can be compared while it has two or more attempts and none is picked', () => {
  const attempts = { branches: ['a-try1', 'a-try2'] };
  assert.equal(canCompare({ attempts }), true);
  assert.equal(canCompare({ attempts: { ...attempts, picked: 'a-try1' } }), false);
  assert.equal(canCompare({ attempts: { branches: ['a-try1'] } }), false);
  assert.equal(canCompare({}), false);
});
