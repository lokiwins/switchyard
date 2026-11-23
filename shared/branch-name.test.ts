import { expect, test } from 'vitest';
import { BRANCH_INPUT_PATTERN, branchFromTask } from './branch-name.ts';

test('branchFromTask keeps the first few words that carry meaning', () => {
  expect(branchFromTask('Fix the login redirect on the settings page')).toBe('fix-login-redirect-settings-page');
  expect(branchFromTask('Please add retries to the GitHub sync, with backoff')).toBe('add-retries-github-sync-backoff');
});

test('branchFromTask makes names git and tmux take without quoting', () => {
  expect(branchFromTask('Renommer «café» → résumé.txt!')).toBe('renommer-cafe-resume-txt');
  expect(branchFromTask('--force push to main?')).toMatch(/^[a-z0-9][a-z0-9-]*$/);
});

test('branchFromTask stays short', () => {
  expect(branchFromTask('investigate intermittent websocket disconnections affecting dashboard users').length <= 40).toBeTruthy();
  expect(branchFromTask('x'.repeat(60)).length).toBe(40);
});

test('branchFromTask falls back to the filler words, then to "task"', () => {
  expect(branchFromTask('Can you do this?')).toBe('do');
  expect(branchFromTask('it is')).toBe('it-is');
  expect(branchFromTask('🙂 ✨')).toBe('task');
});

test('the Branch field pattern compiles as browsers compile it, and takes branch names only', () => {
  // A pattern attribute is matched whole, with the v flag.
  const pattern = new RegExp(`^(?:${BRANCH_INPUT_PATTERN})$`, 'v');
  expect(pattern.test('fix/login-bug')).toBe(true);
  expect(pattern.test('release_1.2')).toBe(true);
  expect(pattern.test('has space')).toBe(false);
  expect(pattern.test('semi;colon')).toBe(false);
});
