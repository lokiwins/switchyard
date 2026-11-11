import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXITED_SHOW_MS, GIVE_UP_MS, SLOW_MS, pendingTask, pendingText, settlePending, startedTask,
} from '../public/pending-tasks.js';

const T0 = 1_000_000;
const created = () => pendingTask({ id: 'p1', repoName: 'shop', branch: '', prompt: 'Show order history', now: T0 });
const result = { path: '/code/shop-show-order-history', branch: 'show-order-history', session: 'switchyard', window: 'shop-show-order-history' };
const started = () => startedTask(created(), result, T0 + 2_000);
const live = (cwd) => ({ sessionId: 's1', pid: 1, cwd, status: 'busy' });

test('a task being created names the branch it will most likely get', () => {
  assert.equal(created().branch, 'show-order-history');
  assert.equal(pendingTask({ id: 'p', repoName: 'shop', branch: ' fix/x ', prompt: 'Anything', now: T0 }).branch, 'fix/x');
  assert.equal(created().stage, 'creating');
});

test('once the server answers, it carries where Claude was started', () => {
  const task = started();
  assert.equal(task.stage, 'starting');
  assert.equal(task.path, result.path);
  assert.equal(task.branch, 'show-order-history');
  assert.equal(task.place, 'switchyard:shop-show-order-history');
  assert.equal(task.startedAt, T0 + 2_000);
  assert.equal(created().stage, 'creating', 'the task it came from is left as it was');
});

test('a started task stays until a live session runs in its worktree', () => {
  const tasks = [created(), started()];
  const before = settlePending(tasks, [live('/code/elsewhere')], T0 + 3_000);
  assert.deepEqual(before.pending.map((t) => t.stage), ['creating', 'starting']);
  assert.deepEqual(before.arrived, []);

  const after = settlePending(tasks, [live('/code/shop-show-order-history/')], T0 + 4_000);
  assert.deepEqual(after.pending.map((t) => t.stage), ['creating']);
  assert.deepEqual(after.arrived.map((t) => t.id), ['p1']);
});

test('a session in a folder inside the worktree does not count as it', () => {
  const { pending } = settlePending([started()], [live('/code/shop-show-order-history-2')], T0 + 3_000);
  assert.equal(pending.length, 1);
});

test('a started task that never shows up is given up on', () => {
  const task = started();
  assert.equal(settlePending([task], [], task.startedAt + GIVE_UP_MS - 1).pending.length, 1);
  const { pending, expired } = settlePending([task], [], task.startedAt + GIVE_UP_MS);
  assert.deepEqual(pending, []);
  assert.deepEqual(expired.map((t) => t.id), ['p1']);
});

test('pendingText says what is happening, and where to look when it is slow', () => {
  assert.deepEqual(pendingText(created(), T0 + 500), { label: 'Creating…', detail: 'Creating the worktree for "Show order history"', note: null });
  const task = started();
  const soon = pendingText(task, task.startedAt + 1_000);
  assert.equal(soon.label, 'Starting…');
  assert.equal(soon.detail, 'Starting Claude in tmux window switchyard:shop-show-order-history');
  assert.equal(soon.note, null);
  const slow = pendingText(task, task.startedAt + SLOW_MS);
  assert.match(slow.note, /Still starting/);
  assert.match(slow.note, /switchyard:shop-show-order-history/);
});

const TRUST = { options: [{ label: 'No, exit', selected: true }, { label: 'Yes, I trust this folder', selected: false }] };
const start = (state, extra = {}) => ({ path: result.path, place: 'switchyard:shop-show-order-history', state, trust: null, detail: null, ...extra });

test('a task whose Claude asks to trust the folder says so', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('asking-trust', { trust: TRUST })]);
  assert.equal(pending[0].stage, 'trust');
  assert.deepEqual(pending[0].trust, TRUST);
  const text = pendingText(pending[0], T0 + 3_000);
  assert.equal(text.label, 'Needs you');
  assert.equal(text.detail, 'Claude asks whether to trust this folder');
  assert.match(text.note, /Trust folder starts Claude/);
  assert.match(text.note, /switchyard:shop-show-order-history/);
});

test('once answered, it is starting again', () => {
  const asking = settlePending([started()], [], T0 + 3_000, [start('asking-trust', { trust: TRUST })]).pending;
  const { pending } = settlePending(asking, [], T0 + 4_000, [start('starting')]);
  assert.equal(pending[0].stage, 'starting');
  assert.equal(pending[0].trust, null);
});

test('a task whose Claude quit says so at once, then goes', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('exited', { detail: 'bash: claude: command not found' })]);
  assert.equal(pending[0].stage, 'exited');
  const text = pendingText(pending[0], T0 + 3_000);
  assert.equal(text.label, "Didn't start");
  assert.equal(text.detail, 'Claude quit before starting: bash: claude: command not found');
  assert.match(text.note, /worktree is still there/);
  assert.match(text.note, /switchyard:shop-show-order-history/);

  const still = settlePending(pending, [], T0 + 3_000 + EXITED_SHOW_MS - 1, []);
  assert.equal(still.pending.length, 1, 'it stays even once the server forgets it');
  const later = settlePending(pending, [], T0 + 3_000 + EXITED_SHOW_MS, []);
  assert.deepEqual(later.pending, []);
  assert.deepEqual(later.expired, [], 'no toast: the row said it');
});

test('an exit with nothing said reads plainly', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('exited')]);
  assert.equal(pendingText(pending[0], T0 + 3_000).detail, 'Claude quit before starting');
});

test('a task still being created takes no notice of starts', () => {
  const { pending } = settlePending([created()], [], T0 + 1_000, [start('exited')]);
  assert.equal(pending[0].stage, 'creating');
});
