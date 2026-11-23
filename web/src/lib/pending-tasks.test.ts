import { expect, test } from 'vitest';
import {
  EXITED_SHOW_MS, GIVE_UP_MS, SLOW_MS, pendingTask, pendingText, settlePending, startedTask,
} from './pending-tasks';

const T0 = 1_000_000;
const created = () => pendingTask({ id: 'p1', repoName: 'shop', branch: '', prompt: 'Show order history', now: T0 });
const result = { path: '/code/shop-show-order-history', branch: 'show-order-history', session: 'switchyard', window: 'shop-show-order-history' };
const started = () => startedTask(created(), result, T0 + 2_000);
const live = (cwd: string) => ({ sessionId: 's1', pid: 1, cwd, status: 'busy' });

test('a task being created names the branch it will most likely get', () => {
  expect(created().branch).toBe('show-order-history');
  expect(pendingTask({ id: 'p', repoName: 'shop', branch: ' fix/x ', prompt: 'Anything', now: T0 }).branch).toBe('fix/x');
  expect(created().stage).toBe('creating');
});

test('once the server answers, it carries where Claude was started', () => {
  const task = started();
  expect(task.stage).toBe('starting');
  expect(task.path).toBe(result.path);
  expect(task.branch).toBe('show-order-history');
  expect(task.place).toBe('switchyard:shop-show-order-history');
  expect(task.startedAt).toBe(T0 + 2_000);
  expect(created().stage, 'the task it came from is left as it was').toBe('creating');
});

test('a started task stays until a live session runs in its worktree', () => {
  const tasks = [created(), started()];
  const before = settlePending(tasks, [live('/code/elsewhere')], T0 + 3_000);
  expect(before.pending.map((t) => t.stage)).toStrictEqual(['creating', 'starting']);
  expect(before.arrived).toStrictEqual([]);

  const after = settlePending(tasks, [live('/code/shop-show-order-history/')], T0 + 4_000);
  expect(after.pending.map((t) => t.stage)).toStrictEqual(['creating']);
  expect(after.arrived.map((t) => t.id)).toStrictEqual(['p1']);
});

test('a session in a folder inside the worktree does not count as it', () => {
  const { pending } = settlePending([started()], [live('/code/shop-show-order-history-2')], T0 + 3_000);
  expect(pending.length).toBe(1);
});

test('a started task that never shows up is given up on', () => {
  const task = started();
  expect(settlePending([task], [], task.startedAt! + GIVE_UP_MS - 1).pending.length).toBe(1);
  const { pending, expired } = settlePending([task], [], task.startedAt! + GIVE_UP_MS);
  expect(pending).toStrictEqual([]);
  expect(expired.map((t) => t.id)).toStrictEqual(['p1']);
});

test('pendingText says what is happening, and where to look when it is slow', () => {
  expect(pendingText(created(), T0 + 500)).toStrictEqual({ label: 'Creating…', detail: 'Creating the worktree for "Show order history"', note: null });
  const task = started();
  const soon = pendingText(task, task.startedAt! + 1_000);
  expect(soon.label).toBe('Starting…');
  expect(soon.detail).toBe('Starting Claude in tmux window switchyard:shop-show-order-history');
  expect(soon.note).toBe(null);
  const slow = pendingText(task, task.startedAt! + SLOW_MS);
  expect(slow.note).toMatch(/Still starting/);
  expect(slow.note).toMatch(/switchyard:shop-show-order-history/);
});

const TRUST = { options: [{ label: 'No, exit', selected: true }, { label: 'Yes, I trust this folder', selected: false }] };
const start = (state: string, extra = {}) => ({ path: result.path, place: 'switchyard:shop-show-order-history', state, trust: null, detail: null, ...extra });

test('a task whose Claude asks to trust the folder says so', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('asking-trust', { trust: TRUST })]);
  expect(pending[0]!.stage).toBe('trust');
  expect(pending[0]!.trust).toStrictEqual(TRUST);
  const text = pendingText(pending[0]!, T0 + 3_000);
  expect(text.label).toBe('Needs you');
  expect(text.detail).toBe('Claude asks whether to trust this folder');
  expect(text.note).toMatch(/Trust folder starts Claude/);
  expect(text.note).toMatch(/switchyard:shop-show-order-history/);
});

test('once answered, it is starting again', () => {
  const asking = settlePending([started()], [], T0 + 3_000, [start('asking-trust', { trust: TRUST })]).pending;
  const { pending } = settlePending(asking, [], T0 + 4_000, [start('starting')]);
  expect(pending[0]!.stage).toBe('starting');
  expect(pending[0]!.trust).toBe(null);
});

test('a task whose Claude quit says so at once, then goes', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('exited', { detail: 'bash: claude: command not found' })]);
  expect(pending[0]!.stage).toBe('exited');
  const text = pendingText(pending[0]!, T0 + 3_000);
  expect(text.label).toBe("Didn't start");
  expect(text.detail).toBe('Claude quit before starting: bash: claude: command not found');
  expect(text.note).toMatch(/worktree is still there/);
  expect(text.note).toMatch(/switchyard:shop-show-order-history/);

  const still = settlePending(pending, [], T0 + 3_000 + EXITED_SHOW_MS - 1, []);
  expect(still.pending.length, 'it stays even once the server forgets it').toBe(1);
  const later = settlePending(pending, [], T0 + 3_000 + EXITED_SHOW_MS, []);
  expect(later.pending).toStrictEqual([]);
  expect(later.expired, 'no toast: the row said it').toStrictEqual([]);
});

test('an exit with nothing said reads plainly', () => {
  const { pending } = settlePending([started()], [], T0 + 3_000, [start('exited')]);
  expect(pendingText(pending[0]!, T0 + 3_000).detail).toBe('Claude quit before starting');
});

test('a task still being created takes no notice of starts', () => {
  const { pending } = settlePending([created()], [], T0 + 1_000, [start('exited')]);
  expect(pending[0]!.stage).toBe('creating');
});
