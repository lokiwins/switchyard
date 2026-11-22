import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EVENTS_PATH, createSessionEvents, endStateFrom, eventHooks, withEventHooks } from '../src/session-events.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const freshDir = () => mkdtempSync(join(tmpdir(), 'sy-events-'));
const hook = (event, extra = {}) => ({ session_id: ID, hook_event_name: event, cwd: '/w', transcript_path: '/t.jsonl', ...extra });

test('the hooks send the turn and session events to switchyard, over HTTP, quickly', () => {
  const hooks = eventHooks(4477);
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionEnd', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  for (const matchers of Object.values(hooks)) {
    assert.deepEqual(matchers, [{ hooks: [{ type: 'http', url: `http://127.0.0.1:4477${EVENTS_PATH}`, timeout: 2 }] }]);
  }
});

test('the hooks are added to a session\'s own settings, keeping what is there', () => {
  const own = { permissions: { allow: ['Edit'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } };
  const settings = withEventHooks(own, 4477);
  assert.deepEqual(settings.permissions, { allow: ['Edit'] });
  assert.equal(settings.hooks.Stop.length, 2);
  assert.deepEqual(settings.hooks.Stop[0], own.hooks.Stop[0]);
  assert.ok(settings.hooks.SessionEnd);
  assert.equal(own.hooks.Stop.length, 1, 'the given settings are not changed');
});

test('how a session ended, from its last turn, with the transcript for what the hooks do not say', () => {
  // No events: the transcript's reading stands.
  assert.equal(endStateFrom(null, 'unknown'), 'unknown');
  assert.equal(endStateFrom({ turn: 'finished' }, 'unknown'), 'finished');
  assert.equal(endStateFrom({ turn: 'finished' }, 'exited'), 'exited', 'an /exit after the turn is still an exit');
  assert.equal(endStateFrom({ turn: 'failed', error: 'rate_limit' }, 'finished'), 'failed');
  // A turn that never stopped: you pressed Esc or ran /exit (the transcript tells which), else it was cut off.
  assert.equal(endStateFrom({ turn: 'running' }, 'finished'), 'interrupted');
  assert.equal(endStateFrom({ turn: 'running' }, 'unknown'), 'interrupted');
  assert.equal(endStateFrom({ turn: 'running' }, 'stopped'), 'stopped');
  assert.equal(endStateFrom({ turn: 'running', ended: 'other' }, 'exited'), 'exited');
});

test('each event moves the session\'s last turn on; a new prompt starts a new one', async () => {
  const events = createSessionEvents({ dir: freshDir(), now: () => 1000 });
  await events.record(hook('UserPromptSubmit', { prompt: 'go' }));
  assert.deepEqual(events.get(ID), { turn: 'running', at: 1000 });
  await events.record(hook('Stop'));
  assert.equal(events.get(ID).turn, 'finished');
  await events.record(hook('UserPromptSubmit'));
  await events.record(hook('StopFailure', { error: 'rate_limit' }));
  assert.deepEqual(events.get(ID), { turn: 'failed', error: 'rate_limit', at: 1000 });
  await events.record(hook('SessionEnd', { reason: 'other' }));
  assert.deepEqual(events.get(ID), { turn: 'failed', error: 'rate_limit', ended: 'other', at: 1000 });
  assert.equal(events.get(OTHER), null);
});

test('only Claude Code\'s own events for a real session id are kept', async () => {
  const events = createSessionEvents({ dir: freshDir() });
  await assert.rejects(events.record(hook('Stop', { session_id: '../../x' })), /session_id/);
  await assert.rejects(events.record({ hook_event_name: 'Stop' }), /session_id/);
  await assert.rejects(events.record(null), /session_id/);
  await events.record(hook('PreToolUse'));
  assert.equal(events.get(ID), null, 'an event it does not track changes nothing');
  await events.record(hook('StopFailure', { error: 'x'.repeat(500) }));
  assert.equal(events.get(ID).error.length <= 64, true, 'an error is kept short');
});

test('the events are kept in switchyard\'s folder, so a restart still knows them; old ones are dropped', async () => {
  const dir = freshDir();
  let clock = 1000;
  const first = createSessionEvents({ dir, now: () => clock, keepForMs: () => 500 });
  await first.record(hook('UserPromptSubmit'));
  await first.record(hook('Stop'));
  const again = createSessionEvents({ dir, now: () => clock, keepForMs: () => 500 });
  await again.load();
  assert.equal(again.get(ID).turn, 'finished');
  clock = 2000;
  await again.record(hook('UserPromptSubmit', { session_id: OTHER }));
  assert.equal(again.get(ID), null, 'older than keepForMs');
  assert.equal(again.get(OTHER).turn, 'running');
});

test('a change is announced, so the page can update', async () => {
  let changes = 0;
  const events = createSessionEvents({ dir: freshDir(), onChange: () => { changes += 1; } });
  await events.record(hook('UserPromptSubmit'));
  await events.record(hook('PreToolUse'));
  assert.equal(changes, 1);
});

test('a session with no settings of its own gets a file with just the hooks, readable by you alone', async () => {
  const { readFileSync, statSync } = await import('node:fs');
  const { createSessionSettings } = await import('../src/session-events.js');
  const dir = freshDir();
  const settings = createSessionSettings({ dir, port: 4477 });
  const path = await settings.file();
  assert.equal(path, join(dir, 'session.settings.json'));
  assert.equal(await settings.file(), path);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { hooks: eventHooks(4477) });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(settings.withHooks({ permissions: { allow: ['Edit'] } }), withEventHooks({ permissions: { allow: ['Edit'] } }, 4477));
});
