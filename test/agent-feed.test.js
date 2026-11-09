import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createAgentFeed, watchFolder } from '../src/agent-feed.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function fakeWatcher() {
  const watcher = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
  let listener = null;
  const watchDir = (dir, onEvent) => {
    watcher.dir = dir;
    listener = onEvent;
    return watcher;
  };
  return { watcher, watchDir, fire: () => listener('change', '123.json') };
}

test('a burst of changes in the folder becomes one call', async () => {
  const { watchDir, fire, watcher } = fakeWatcher();
  let calls = 0;
  const stop = watchFolder('/home/.claude/sessions', () => { calls += 1; }, { watchDir, gatherMs: 5 });
  assert.equal(watcher.dir, '/home/.claude/sessions');
  fire();
  fire();
  fire();
  await wait(20);
  assert.equal(calls, 1);
  fire();
  await wait(20);
  assert.equal(calls, 2);
  stop();
  assert.equal(watcher.closed, true);
});

test('a folder that cannot be watched is reported and left to the poll', () => {
  const errors = [];
  const stop = watchFolder('/missing', () => {}, {
    watchDir: () => { throw Object.assign(new Error('no such folder'), { code: 'ENOENT' }); },
    onError: (error) => errors.push(error.message),
  });
  assert.deepEqual(errors, ['no such folder']);
  stop();
});

test('a watcher that fails later is reported too', () => {
  const { watchDir, watcher } = fakeWatcher();
  const errors = [];
  watchFolder('/dir', () => {}, { watchDir, onError: (error) => errors.push(error.message) });
  watcher.emit('error', new Error('watch failed'));
  assert.deepEqual(errors, ['watch failed']);
});

test('each change sends fresh data to every subscriber', async () => {
  let version = 0;
  const feed = createAgentFeed({ load: async () => ({ version: ++version }) });
  const a = [];
  const b = [];
  feed.subscribe((data) => a.push(data.version));
  const stopB = feed.subscribe((data) => b.push(data.version));
  feed.changed();
  await tick();
  stopB();
  feed.changed();
  await tick();
  assert.deepEqual(a, [1, 2]);
  assert.deepEqual(b, [1]);
});

test('changes during a load start one more load after it, so the last update is current', async () => {
  let loads = 0;
  let release = null;
  const feed = createAgentFeed({
    load: () => new Promise((resolve) => {
      loads += 1;
      release = () => resolve(loads);
    }),
  });
  const sent = [];
  feed.subscribe((data) => sent.push(data));
  feed.changed();
  feed.changed();
  feed.changed();
  assert.equal(loads, 1, 'one load at a time');
  release();
  await tick();
  assert.equal(loads, 2, 'the changes during the first load make one more');
  release();
  await tick();
  assert.deepEqual(sent, [1, 2]);
});

test('nothing loads while no page is listening', async () => {
  let loads = 0;
  const feed = createAgentFeed({ load: async () => { loads += 1; } });
  feed.changed();
  await tick();
  assert.equal(loads, 0);
});

test('a failed load is reported and the feed keeps going', async () => {
  const errors = [];
  let fail = true;
  const feed = createAgentFeed({
    load: async () => { if (fail) throw new Error('scan failed'); return 'ok'; },
    onError: (error) => errors.push(error.message),
  });
  const sent = [];
  feed.subscribe((data) => sent.push(data));
  feed.changed();
  await tick();
  fail = false;
  feed.changed();
  await tick();
  assert.deepEqual(errors, ['scan failed']);
  assert.deepEqual(sent, ['ok']);
});
