import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupSummary, whatsLeft, whyAsked } from '../public/worktree-choices.js';

const empty = { ended: [], removed: [], choices: [], errors: [] };

test('the summary says what was put away, and nothing when there was nothing', () => {
  assert.equal(cleanupSummary(null), '');
  assert.equal(cleanupSummary(empty), '');
  assert.equal(cleanupSummary({ ...empty, ended: ['a'], removed: ['/x', '/y'], choices: [{}] }), 'ended 1 session · removed 2 worktrees · 1 worktree needs your choice');
  assert.equal(cleanupSummary({ ...empty, choices: [{}, {}] }), '2 worktrees need your choice');
});

test('a kept worktree says what deleting it would touch', () => {
  assert.equal(whatsLeft({ changes: 3, unmerged: 0 }), '3 uncommitted files');
  assert.equal(whatsLeft({ changes: 0, unmerged: 1 }), '1 commit not merged');
  assert.equal(whatsLeft({ changes: 1, unmerged: 2 }), '1 uncommitted file and 2 commits not merged');
});

test('the notice says why it asks: the task closed, or another attempt was picked', () => {
  assert.equal(whyAsked({ taskTitle: 'Fix the cart', why: 'closed' }), 'Fix the cart is closed.');
  assert.equal(whyAsked({ taskTitle: 'Fix the cart' }), 'Fix the cart is closed.');
  assert.equal(whyAsked({ taskTitle: 'Fix the cart', why: 'not-picked' }), 'Fix the cart: you picked another attempt.');
});
