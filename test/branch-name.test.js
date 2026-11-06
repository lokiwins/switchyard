import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchFromTask } from '../public/branch-name.js';

test('branchFromTask keeps the first few words that carry meaning', () => {
  assert.equal(branchFromTask('Fix the login redirect on the settings page'), 'fix-login-redirect-settings-page');
  assert.equal(branchFromTask('Please add retries to the GitHub sync, with backoff'), 'add-retries-github-sync-backoff');
});

test('branchFromTask makes names git and tmux take without quoting', () => {
  assert.equal(branchFromTask('Renommer «café» → résumé.txt!'), 'renommer-cafe-resume-txt');
  assert.match(branchFromTask('--force push to main?'), /^[a-z0-9][a-z0-9-]*$/);
});

test('branchFromTask stays short', () => {
  assert.ok(branchFromTask('investigate intermittent websocket disconnections affecting dashboard users').length <= 40);
  assert.equal(branchFromTask('x'.repeat(60)).length, 40);
});

test('branchFromTask falls back to the filler words, then to "task"', () => {
  assert.equal(branchFromTask('Can you do this?'), 'do');
  assert.equal(branchFromTask('it is'), 'it-is');
  assert.equal(branchFromTask('🙂 ✨'), 'task');
});
