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
