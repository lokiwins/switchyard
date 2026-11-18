import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile } from '../src/json-store.js';
import { createSessionRemoval, isHidden } from '../src/session-removal.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';
const LIVE = 'cccccccc-1111-2222-3333-444444444444';

function setup({ ended = [{ sessionId: A, endedAt: NOW - 1000 }, { sessionId: B, endedAt: NOW - 2000 }], now = () => NOW, keepForMs = () => 7 * 86_400_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'switchyard-removal-'));
  const claudeDir = join(root, 'claude');
  const project = join(claudeDir, 'projects', '-Users-me-repo');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${A}.jsonl`), '{"type":"user"}\n');
  mkdirSync(join(project, A, 'subagents'), { recursive: true });
  writeFileSync(join(project, A, 'subagents', 'agent-1.jsonl'), '{}\n');
  writeFileSync(join(project, `${B}.jsonl`), '{"type":"user"}\n');
  const trashDir = join(root, 'Trash');
  mkdirSync(trashDir);
  const store = join(root, 'store');
  let changes = 0;
  const removal = createSessionRemoval({
    file: createJsonFile(store, 'hidden-sessions.json'),
    claudeDir,
    trashDir,
    getState: async () => ({ endedSessions: ended, liveSessions: [{ sessionId: LIVE }] }),
    onChange: () => { changes += 1; },
    now,
    keepForMs,
  });
  return { removal, project, trashDir, store, changes: () => changes };
}

const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('hiding ended sessions remembers them, with when each ended, and announces the change', async () => {
  const { removal, store, changes } = setup();
  assert.deepEqual(await removal.hide({ sessionIds: [A, B] }), { hidden: [A, B] });
  const hidden = await removal.hidden();
  assert.equal(hidden.get(A), NOW - 1000);
  assert.equal(hidden.get(B), NOW - 2000);
  assert.equal(changes(), 1);
  // Kept across restarts, in switchyard's own folder.
  const saved = JSON.parse(readFileSync(join(store, 'hidden-sessions.json'), 'utf8'));
  assert.deepEqual(saved.sessions, { [A]: NOW - 1000, [B]: NOW - 2000 });
});

test('a hidden session stays hidden until it is resumed and ends again', () => {
  const hidden = new Map([[A, NOW - 1000]]);
  assert.equal(isHidden({ sessionId: A, endedAt: NOW - 1000 }, hidden), true);
  assert.equal(isHidden({ sessionId: A, endedAt: NOW + 5000 }, hidden), false);
  assert.equal(isHidden({ sessionId: B, endedAt: NOW - 1000 }, hidden), false);
});

test('showing hidden sessions again forgets them', async () => {
  const { removal } = setup();
  await removal.hide({ sessionIds: [A, B] });
  assert.deepEqual(await removal.unhide({ sessionIds: [A] }), { shown: [A] });
  assert.deepEqual([...(await removal.hidden()).keys()], [B]);
});

test('only ended sessions can be hidden; running and unknown ones are refused', async () => {
  const { removal } = setup();
  await rejectsWith(removal.hide({ sessionIds: [LIVE] }), 404, /ended/);
  await rejectsWith(removal.hide({ sessionIds: ['dddddddd-0000-0000-0000-000000000000'] }), 404);
  // Any ended ones among them are still hidden.
  assert.deepEqual(await removal.hide({ sessionIds: [A, LIVE] }), { hidden: [A] });
});

test('hide and unhide refuse what the page should never send', async () => {
  const { removal } = setup();
  for (const body of [undefined, {}, { sessionIds: [] }, { sessionIds: 'x' }, { sessionIds: ['../etc/passwd'] }, { sessionIds: [42] }, { sessionIds: Array(1001).fill(A) }]) {
    await rejectsWith(removal.hide(body), 400);
    await rejectsWith(removal.unhide(body), 400);
  }
});

test('deleting a transcript moves it and its folder to the Trash, and undo puts them back', async () => {
  const { removal, project, trashDir, changes } = setup();
  assert.deepEqual(await removal.trash({ sessionId: A }), { trashed: A });
  assert.equal(existsSync(join(project, `${A}.jsonl`)), false);
  assert.equal(existsSync(join(project, A)), false);
  assert.equal(existsSync(join(trashDir, `${A}.jsonl`)), true);
  assert.equal(existsSync(join(trashDir, A, 'subagents', 'agent-1.jsonl')), true);
  assert.equal(changes(), 1);

  assert.deepEqual(await removal.restore({ sessionId: A }), { restored: A });
  assert.equal(readFileSync(join(project, `${A}.jsonl`), 'utf8'), '{"type":"user"}\n');
  assert.equal(existsSync(join(project, A, 'subagents', 'agent-1.jsonl')), true);
  assert.equal(existsSync(join(trashDir, `${A}.jsonl`)), false);
  assert.equal(changes(), 2);
});

test('a transcript is never put over something already in the Trash', async () => {
  const { removal, trashDir } = setup();
  writeFileSync(join(trashDir, `${B}.jsonl`), 'older');
  await removal.trash({ sessionId: B });
  assert.equal(readFileSync(join(trashDir, `${B}.jsonl`), 'utf8'), 'older');
  assert.equal(existsSync(join(trashDir, `${B} 2.jsonl`)), true);
});

test('only an ended session\'s transcript can be deleted', async () => {
  const { removal } = setup();
  await rejectsWith(removal.trash({ sessionId: LIVE }), 404, /ended/);
  await rejectsWith(removal.trash({ sessionId: '../../x' }), 400);
  await rejectsWith(removal.trash({}), 400);
});

test('deleting a transcript that is already gone says so', async () => {
  const { removal, project } = setup({ ended: [{ sessionId: A, endedAt: NOW }] });
  await removal.trash({ sessionId: A });
  await rejectsWith(removal.trash({ sessionId: A }), 404);
  assert.equal(existsSync(join(project, `${B}.jsonl`)), true);
});

test('undo only works for a while, and never over a transcript that came back', async () => {
  let t = NOW;
  const { removal, project } = setup({ now: () => t });
  await removal.trash({ sessionId: A });
  t += 11 * 60_000;
  await rejectsWith(removal.restore({ sessionId: A }), 410);

  await removal.trash({ sessionId: B });
  writeFileSync(join(project, `${B}.jsonl`), 'new');
  await rejectsWith(removal.restore({ sessionId: B }), 409);
  assert.equal(readFileSync(join(project, `${B}.jsonl`), 'utf8'), 'new');
});

test('the file only keeps sessions still young enough to be listed, so it never keeps growing', async () => {
  let t = NOW;
  const { removal, store } = setup({ now: () => t, keepForMs: () => 5000 });
  await removal.hide({ sessionIds: [A, B] });
  // B ended 2s before A; 4.5s later only A could still be on the list.
  t = NOW + 3500;
  await removal.unhide({ sessionIds: ['eeeeeeee-0000-0000-0000-000000000000'] });
  assert.deepEqual([...(await removal.hidden()).keys()], [A]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(store, 'hidden-sessions.json'), 'utf8')).sessions), [A]);
});

test('forget takes sessions off the lists as told, for a task being put away (sessions it just ended included)', async () => {
  const { removal, changes } = setup();
  await removal.forget([{ sessionId: LIVE, endedAt: NOW }, { sessionId: A, endedAt: NOW - 1000 }]);
  const hidden = await removal.hidden();
  assert.equal(hidden.get(LIVE), NOW);
  assert.equal(hidden.get(A), NOW - 1000);
  assert.equal(changes(), 1);
});
