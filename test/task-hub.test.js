import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile } from '../src/json-store.js';
import { TASK_ID, createTaskHub, parseTaskFields } from '../src/task-hub.js';

const NOW = Date.UTC(2026, 10, 10, 12);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'switchyard-hub-'));
  let n = 0;
  const hub = createTaskHub({ file: createJsonFile(dir, 'tasks.json'), now: () => NOW, newId: () => `sy-${String((n += 1)).padStart(6, '0')}` });
  return { hub, dir, file: join(dir, 'tasks.json') };
}

const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('a new task id is short, lowercase, and stands alone in a branch name', () => {
  const ids = new Set(Array.from({ length: 200 }, () => TASK_ID.generate()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^sy-[a-z0-9]{6}$/);
});

test('parseTaskFields takes a title, and optional notes, due date and links', () => {
  assert.deepEqual(parseTaskFields({ title: '  Fix the login bug  ' }), { title: 'Fix the login bug', notes: '', dueOn: null, links: [] });
  assert.deepEqual(parseTaskFields({
    title: 'Ship it', notes: 'Line one\nLine two', dueOn: '2026-11-20', links: [' https://app.clickup.com/t/86b4fx1 ', '', 'https://github.com/o/r/issues/4'],
  }), {
    title: 'Ship it', notes: 'Line one\nLine two', dueOn: '2026-11-20', links: ['https://app.clickup.com/t/86b4fx1', 'https://github.com/o/r/issues/4'],
  });
});

test('parseTaskFields refuses what the page should never send', () => {
  for (const [body, pattern] of [
    [{}, /title/],
    [{ title: '   ' }, /title/],
    [{ title: 'x'.repeat(201) }, /title/],
    [{ title: 'tab\tin it' }, /title/],
    [{ title: 't', notes: 'x'.repeat(10_001) }, /notes/],
    [{ title: 't', dueOn: '2026-13-01' }, /date/],
    [{ title: 't', dueOn: 'tomorrow' }, /date/],
    [{ title: 't', links: ['javascript:alert(1)'] }, /link/],
    [{ title: 't', links: ['not a url'] }, /link/],
    [{ title: 't', links: Array.from({ length: 21 }, (_, i) => `https://x.test/${i}`) }, /links/],
    [{ title: 't', links: 'https://x.test' }, /links/],
  ]) {
    assert.throws(() => parseTaskFields(body), (error) => error.status === 400 && pattern.test(error.message), JSON.stringify(body).slice(0, 80));
  }
});

test('parseTaskFields with partial: only the fields given', () => {
  assert.deepEqual(parseTaskFields({ dueOn: null }, { partial: true }), { dueOn: null });
  assert.deepEqual(parseTaskFields({ notes: 'More' }, { partial: true }), { notes: 'More' });
  assert.throws(() => parseTaskFields({ title: '' }, { partial: true }), (error) => error.status === 400);
});

test('create adds a task, newest first, and keeps it in the file', async () => {
  const { hub, file } = setup();
  const first = await hub.create({ title: 'First' });
  const second = await hub.create({ title: 'Second', dueOn: '2026-11-12' });
  assert.deepEqual(first, {
    id: 'sy-000001', title: 'First', notes: '', dueOn: null, links: [], createdAt: NOW, updatedAt: NOW, closedAs: null, closedAt: null,
  });
  assert.deepEqual((await hub.list()).map((t) => t.id), [second.id, first.id]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).tasks.map((t) => t.title), ['Second', 'First']);
});

test('the file is readable only by you', async () => {
  const { hub, file, dir } = setup();
  await hub.create({ title: 'Private' });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('update changes only the fields given', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Draft', notes: 'Keep me' });
  const updated = await hub.update({ id: task.id, title: 'Final', dueOn: '2026-12-01' });
  assert.equal(updated.title, 'Final');
  assert.equal(updated.notes, 'Keep me');
  assert.equal(updated.dueOn, '2026-12-01');
  await rejectsWith(hub.update({ id: 'sy-nope00', title: 'x' }), 404);
});

test('close marks a task done or dropped; reopen undoes it', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Ship' });
  const done = await hub.close({ id: task.id, as: 'done' });
  assert.equal(done.closedAs, 'done');
  assert.equal(done.closedAt, NOW);
  await rejectsWith(hub.close({ id: task.id, as: 'finished' }), 400);
  const open = await hub.reopen({ id: task.id });
  assert.equal(open.closedAs, null);
  assert.equal(open.closedAt, null);
});

test('remove deletes a task for good', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Oops' });
  await hub.remove({ id: task.id });
  assert.deepEqual(await hub.list(), []);
  await rejectsWith(hub.remove({ id: task.id }), 404);
});

test('changes made at the same time are all kept', async () => {
  const { hub } = setup();
  await Promise.all(Array.from({ length: 10 }, (_, i) => hub.create({ title: `Task ${i}` })));
  assert.equal((await hub.list()).length, 10);
});

test('a missing or damaged file reads as no tasks', async () => {
  const { hub } = setup();
  assert.deepEqual(await hub.list(), []);
  const broken = createTaskHub({ file: { read: async () => ({ tasks: 'nope' }), write: async () => {} } });
  assert.deepEqual(await broken.list(), []);
});

test('create can save where the task\'s work already is: a branch, or one session', async () => {
  const { hub } = setup();
  const onBranch = await hub.create({ title: 'From a session' }, { attached: [{ repo: '/code/shop', branch: 'feat/receipts' }] });
  assert.deepEqual(onBranch.attached, [{ repo: '/code/shop', branch: 'feat/receipts' }]);
  const onMain = await hub.create({ title: 'From main' }, { attached: [{ sessionId: '0b6c3c1e-8a52-4a8e-9a43-0c5c1f3e2d11' }] });
  assert.deepEqual(onMain.attached, [{ sessionId: '0b6c3c1e-8a52-4a8e-9a43-0c5c1f3e2d11' }]);
  const plain = await hub.create({ title: 'Plain' });
  assert.equal('attached' in plain, false, 'a task made on the Tasks page has none');
});

test('what the page sends can\'t set where a task is attached; only the server can', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Sneaky', attached: [{ repo: '/etc', branch: 'x' }] });
  assert.equal('attached' in task, false);
  const updated = await hub.update({ id: task.id, attached: [{ repo: '/etc', branch: 'x' }] });
  assert.equal('attached' in updated, false);
});

test('an update keeps where the task is attached', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Keep' }, { attached: [{ repo: '/code/shop', branch: 'feat/a' }] });
  const updated = await hub.update({ id: task.id, title: 'Kept' });
  assert.deepEqual(updated.attached, [{ repo: '/code/shop', branch: 'feat/a' }]);
});

test('a subtask names its parent; the parent must be there, open, and not a subtask itself', async () => {
  const { hub } = setup();
  const parent = await hub.create({ title: 'Ship the cart' });
  const child = await hub.create({ title: 'Fix the totals', parentId: parent.id });
  assert.equal(child.parentId, parent.id);
  await rejectsWith(hub.create({ title: 'Grandchild', parentId: child.id }), 400, /subtask/);
  await rejectsWith(hub.create({ title: 'Orphan', parentId: 'sy-gone00' }), 404);
  await rejectsWith(hub.create({ title: 'Bad', parentId: 42 }), 400);
  await hub.close({ id: parent.id, as: 'done' });
  await rejectsWith(hub.create({ title: 'Late', parentId: parent.id }), 409, /done/);
  // An update never moves a task to another parent.
  const updated = await hub.update({ id: child.id, title: 'Fix the totals again', parentId: null });
  assert.equal(updated.parentId, parent.id);
});

test('closing a task closes its open subtasks the same way, and says which', async () => {
  const { hub } = setup();
  const parent = await hub.create({ title: 'Ship the cart' });
  const open = await hub.create({ title: 'Fix the totals', parentId: parent.id });
  const done = await hub.create({ title: 'Add tax', parentId: parent.id });
  await hub.close({ id: done.id, as: 'done' });
  const closed = await hub.closeWithSubtasks({ id: parent.id, as: 'dropped' });
  assert.deepEqual(closed.map((t) => [t.id, t.closedAs]), [[parent.id, 'dropped'], [open.id, 'dropped']]);
  const byId = Object.fromEntries((await hub.list()).map((t) => [t.id, t.closedAs]));
  assert.deepEqual([byId[open.id], byId[done.id]], ['dropped', 'done'], 'a subtask already closed keeps how it closed');
});

test('deleting a task deletes its subtasks, and says which', async () => {
  const { hub } = setup();
  const parent = await hub.create({ title: 'Ship the cart' });
  const child = await hub.create({ title: 'Fix the totals', parentId: parent.id });
  const other = await hub.create({ title: 'Unrelated' });
  const removed = await hub.removeWithSubtasks({ id: parent.id });
  assert.deepEqual(removed.map((t) => t.id).sort(), [parent.id, child.id].sort());
  assert.deepEqual((await hub.list()).map((t) => t.id), [other.id]);
  await rejectsWith(hub.removeWithSubtasks({ id: parent.id }), 404);
});

test('a review is noted on its task: the latest one for each worktree', async () => {
  const { hub } = setup();
  const task = await hub.create({ title: 'Fix the totals' });
  await hub.noteReview(task.id, { path: '/code/a', sessionId: 's1', startedAt: 1 });
  await hub.noteReview(task.id, { path: '/code/b', sessionId: 's2', startedAt: 2 });
  await hub.noteReview(task.id, { path: '/code/a', sessionId: 's3', startedAt: 3 });
  const [saved] = await hub.list();
  assert.deepEqual(saved.reviews, [{ path: '/code/b', sessionId: 's2', startedAt: 2 }, { path: '/code/a', sessionId: 's3', startedAt: 3 }]);
  await assert.rejects(hub.noteReview('sy-gone00', { path: '/x', sessionId: 's', startedAt: 1 }), (error) => error.status === 404);
});
