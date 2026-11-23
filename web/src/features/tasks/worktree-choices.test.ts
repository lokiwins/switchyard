import { expect, test } from 'vitest';
import { cleanupSummary, whatsLeft } from './worktree-choices';

const empty = { ended: [], removed: [], choices: [], errors: [] };

test('the summary says what was put away, and nothing when there was nothing', () => {
  expect(cleanupSummary(null)).toBe('');
  expect(cleanupSummary(empty)).toBe('');
  expect(cleanupSummary({ ...empty, ended: ['a'], removed: ['/x', '/y'], choices: [{}] })).toBe('ended 1 session · removed 2 worktrees · 1 worktree needs your choice');
  expect(cleanupSummary({ ...empty, choices: [{}, {}] })).toBe('2 worktrees need your choice');
});

test('a kept worktree says what deleting it would touch', () => {
  expect(whatsLeft({ changes: 3, unmerged: 0 })).toBe('3 uncommitted files');
  expect(whatsLeft({ changes: 0, unmerged: 1 })).toBe('1 commit not merged');
  expect(whatsLeft({ changes: 1, unmerged: 2 })).toBe('1 uncommitted file and 2 commits not merged');
});
