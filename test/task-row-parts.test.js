import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskRowParts } from '../public/task-row-parts.js';

const NOW = Date.UTC(2026, 10, 19, 12);
const LINK = {
  path: '/code/billing-api-fix', repoName: 'billing-api', branch: 'sy-1-fix', pr: null, checks: [], checkNames: [],
  live: [{ sessionId: 's1', status: 'idle', statusUpdatedAt: 1 }], recent: [],
};
const TASK = {
  id: 'sy-1', title: 'Fix the totals', notes: 'Round once', links: [], dueOn: null, state: 'working',
  closedAs: null, parentId: null, start: null, work: [LINK], subtasks: [],
};
const CONTEXT = {
  now: NOW, caps: { tmux: true, terminal: true }, approvals: [],
  repos: [{ name: 'billing-api', mainPath: '/code/billing-api' }],
};

const sigs = (task, context = CONTEXT) => Object.fromEntries(taskRowParts(task, context).map((p) => [p.key, p.sig]));
const changed = (before, after) => Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();

test('a row is its parts, in order: state, title, detail, due date, buttons, then each worktree', () => {
  assert.deepEqual(taskRowParts(TASK, CONTEXT).map((p) => p.key), ['state', 'who', 'detail', 'due', 'actions', `link:${LINK.path}`]);
  assert.deepEqual(taskRowParts({ ...TASK, work: [] }, CONTEXT).map((p) => p.key), ['state', 'who', 'detail', 'due', 'actions']);
});

test('nothing changed: every part is the same as last time', () => {
  assert.deepEqual(changed(sigs(TASK), sigs(structuredClone(TASK))), []);
});

test('a worktree\'s session changing redraws only that worktree, not the buttons with their open menus', () => {
  const busy = { ...TASK, work: [{ ...LINK, live: [{ ...LINK.live[0], status: 'busy', statusUpdatedAt: 2 }] }] };
  assert.deepEqual(changed(sigs(TASK), sigs(busy)), [`link:${LINK.path}`]);
});

test('new notes redraw only the detail line', () => {
  assert.deepEqual(changed(sigs(TASK), sigs({ ...TASK, notes: 'Round at the end' })), ['detail']);
});

test('a question for another session leaves this row alone; one for its own session redraws its worktree', () => {
  const other = { ...CONTEXT, approvals: [{ id: 'a1', sessionId: 'elsewhere' }] };
  assert.deepEqual(changed(sigs(TASK), sigs(TASK, other)), []);
  const own = { ...CONTEXT, approvals: [{ id: 'a2', sessionId: 's1' }] };
  assert.deepEqual(changed(sigs(TASK), sigs(TASK, own)), [`link:${LINK.path}`]);
});

test('the buttons are drawn again when what they offer changes', () => {
  const notStarted = { ...TASK, state: 'not-started', work: [] };
  const base = sigs(notStarted);
  assert.ok(changed(base, sigs({ ...notStarted, state: 'working' })).includes('actions'), 'Start goes away');
  assert.ok(changed(base, sigs(notStarted, { ...CONTEXT, repos: [...CONTEXT.repos, { name: 'web', mainPath: '/code/web' }] })).includes('actions'), 'a new repo to start in');
  assert.ok(changed(base, sigs({ ...notStarted, closedAs: 'done', state: 'done' })).includes('actions'), 'Reopen instead of Mark done');
  assert.ok(changed(base, sigs({ ...notStarted, subtasks: [{ id: 'sy-2' }] })).includes('actions'), 'Delete names its subtasks');
  assert.ok(changed(sigs(TASK), sigs({ ...TASK, work: [{ ...LINK, checks: [{ name: 'test', state: 'failed' }] }] })).includes('actions'), 'Mark done anyway');
});

test('repos only matter to the buttons while the task can be started', () => {
  const more = { ...CONTEXT, repos: [...CONTEXT.repos, { name: 'web', mainPath: '/code/web' }] };
  assert.deepEqual(changed(sigs(TASK), sigs(TASK, more)), []);
});

test('a subtask\'s Start follows its parent\'s branch', () => {
  const sub = { ...TASK, id: 'sy-2', parentId: 'sy-1', state: 'not-started', work: [] };
  const parent = TASK;
  const moved = { ...TASK, work: [{ ...LINK, branch: 'sy-1-other' }] };
  assert.ok(changed(sigs(sub, { ...CONTEXT, parent }), sigs(sub, { ...CONTEXT, parent: moved })).includes('actions'));
  const parentNotes = { ...TASK, notes: 'changed' };
  assert.deepEqual(changed(sigs(sub, { ...CONTEXT, parent }), sigs(sub, { ...CONTEXT, parent: parentNotes })), [], 'the rest of the parent doesn\'t matter');
});

test('the due date is drawn as of now, and not at all once closed', () => {
  const due = { ...TASK, dueOn: '2026-11-19' };
  assert.notEqual(sigs(due).due, sigs(due, { ...CONTEXT, now: NOW + 2 * 86_400_000 }).due, 'today, then overdue');
  assert.equal(sigs({ ...due, state: 'done', closedAs: 'done' }).due, sigs({ ...TASK, state: 'done', closedAs: 'done' }).due);
});
