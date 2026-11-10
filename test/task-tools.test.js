import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionError } from '../src/errors.js';
import { createTaskTools, createTokenStore, defaultStoreDir } from '../src/task-tools.js';

const TOKEN = 'pk_1234567_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const TASK = { id: 't1', name: 'Show order history', status: { name: 'to do', color: '#87909e' } };

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

/** A ClickUp client that answers as `token` would, counting task fetches. */
function fakeClickUp({ valid = TOKEN, workspaces = [{ id: '901', name: 'Acme' }], tasks = [TASK] } = {}) {
  const calls = { tasks: 0, tokens: [] };
  const clickupFor = (token) => {
    calls.tokens.push(token);
    const check = async () => {
      if (token !== valid) throw new ActionError(401, 'ClickUp refused the token');
    };
    return {
      user: async () => { await check(); return { id: 7, username: 'dev' }; },
      workspaces: async () => { await check(); return workspaces; },
      assignedTasks: async (workspaceId, userId) => {
        await check();
        calls.tasks += 1;
        calls.last = { workspaceId, userId };
        return tasks;
      },
    };
  };
  return { clickupFor, calls };
}

const memoryStore = (initial = {}) => {
  let data = structuredClone(initial);
  return { read: async () => structuredClone(data), write: async (next) => { data = structuredClone(next); }, peek: () => data };
};

const tools = (overrides = {}) => {
  const store = overrides.store ?? memoryStore();
  const fake = fakeClickUp(overrides.clickup);
  return { service: createTaskTools({ store, clickupFor: fake.clickupFor, ttlMs: 60_000, now: overrides.now }), store, ...fake };
};

test('before connecting, ClickUp is offered and the other tools are shown as coming later', async () => {
  const { service } = tools();
  const { tools: cards } = await service.sources();
  assert.deepEqual(cards.map((c) => [c.id, c.available, c.connected]), [
    ['clickup', true, false], ['linear', false, false], ['jira', false, false], ['github-issues', false, false],
  ]);
});

test('connecting checks the token with ClickUp, then keeps it with your name and workspaces', async () => {
  const { service, store } = tools();
  const { tools: [clickup] } = await service.connect({ tool: 'clickup', token: ` ${TOKEN} ` });
  assert.equal(clickup.connected, true);
  assert.deepEqual(clickup.user, { id: 7, username: 'dev' });
  assert.deepEqual(clickup.workspaces, [{ id: '901', name: 'Acme' }]);
  assert.equal(clickup.workspaceId, '901');
  assert.equal(store.peek().clickup.token, TOKEN);
});

test('the token never leaves the server: not in what the page is sent', async () => {
  const { service } = tools();
  const sent = JSON.stringify([await service.connect({ tool: 'clickup', token: TOKEN }), await service.sources(), await service.tasks()]);
  assert.ok(!sent.includes(TOKEN));
});

test('a token ClickUp refuses is not kept', async () => {
  const { service, store } = tools();
  await rejectsWith(service.connect({ tool: 'clickup', token: 'pk_9999999_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' }), 401);
  assert.equal(store.peek().clickup, undefined);
});

test('requests are checked before anything is asked of ClickUp', async () => {
  const { service, calls } = tools();
  await rejectsWith(service.connect({ tool: 'clickup', token: 'not a token' }), 400);
  await rejectsWith(service.connect({ tool: 'jira', token: TOKEN }), 400);
  await rejectsWith(service.connect(null), 400);
  assert.equal(calls.tokens.length, 0);
});

test('tasks: the ones assigned to you in the chosen workspace, cached for a while', async () => {
  let now = 1_000;
  const { service, calls } = tools({ now: () => now });
  await service.connect({ tool: 'clickup', token: TOKEN });
  const first = await service.tasks();
  assert.deepEqual(first.tasks, [TASK]);
  assert.equal(first.workspace.name, 'Acme');
  assert.deepEqual(calls.last, { workspaceId: '901', userId: 7 });
  now += 30_000;
  await service.tasks();
  assert.equal(calls.tasks, 1, 'served from the cache');
  await service.tasks({ force: true });
  assert.equal(calls.tasks, 2, 'Refresh asks again');
  now += 61_000;
  await service.tasks();
  assert.equal(calls.tasks, 3, 'and so does an old cache');
});

test('tasks before connecting: none, and nothing asked of ClickUp', async () => {
  const { service, calls } = tools();
  assert.deepEqual(await service.tasks(), { connected: false, tasks: [] });
  assert.equal(calls.tokens.length, 0);
});

test('choosing a workspace takes only one of yours, and shows its tasks', async () => {
  const workspaces = [{ id: '901', name: 'Acme' }, { id: '902', name: 'Side project' }];
  const { service, calls } = tools({ clickup: { workspaces } });
  await service.connect({ tool: 'clickup', token: TOKEN });
  await service.tasks();
  await rejectsWith(service.chooseWorkspace({ tool: 'clickup', workspaceId: '999' }), 400);
  const { tools: [clickup] } = await service.chooseWorkspace({ tool: 'clickup', workspaceId: '902' });
  assert.equal(clickup.workspaceId, '902');
  await service.tasks();
  assert.equal(calls.last.workspaceId, '902');
});

test('disconnecting forgets the token and the cached tasks', async () => {
  const { service, store } = tools();
  await service.connect({ tool: 'clickup', token: TOKEN });
  await service.tasks();
  const { tools: [clickup] } = await service.disconnect({ tool: 'clickup' });
  assert.equal(clickup.connected, false);
  assert.equal(store.peek().clickup, undefined);
  assert.deepEqual(await service.tasks(), { connected: false, tasks: [] });
});

test('a token ClickUp stops accepting shows as an error with the tasks, not a crash', async () => {
  const store = memoryStore({ clickup: { token: 'pk_0000000_REVOKEDREVOKEDREVOKEDREVOKED00', user: { id: 7, username: 'dev' }, workspaces: [{ id: '901', name: 'Acme' }], workspaceId: '901' } });
  const { service } = tools({ store });
  const result = await service.tasks();
  assert.equal(result.connected, true);
  assert.deepEqual(result.tasks, []);
  assert.match(result.error, /refused/);
});

test('the token file is readable only by you, outside the checkout', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'switchyard-tools-')), 'switchyard');
  const store = createTokenStore(dir);
  assert.deepEqual(await store.read(), {});
  await store.write({ clickup: { token: TOKEN } });
  const file = join(dir, 'task-tools.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).clickup.token, TOKEN);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(defaultStoreDir({ HOME: '/home/dev' }), '/home/dev/.config/switchyard');
  assert.equal(defaultStoreDir({ HOME: '/home/dev', XDG_CONFIG_HOME: '/cfg' }), '/cfg/switchyard');
});

test('a token file that is not JSON reads as not connected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchyard-tools-'));
  writeFileSync(join(dir, 'task-tools.json'), '{oops');
  assert.deepEqual(await createTokenStore(dir).read(), {});
});

test('saves made at the same time all land, one after another', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'switchyard-tools-')), 'switchyard');
  const workspaces = [{ id: '901', name: 'Acme' }, { id: '902', name: 'Side project' }];
  const { clickupFor } = fakeClickUp({ workspaces });
  const service = createTaskTools({ store: createTokenStore(dir), clickupFor });
  await service.connect({ tool: 'clickup', token: TOKEN });
  await Promise.all([
    service.chooseWorkspace({ tool: 'clickup', workspaceId: '902' }),
    service.chooseWorkspace({ tool: 'clickup', workspaceId: '901' }),
    service.chooseWorkspace({ tool: 'clickup', workspaceId: '902' }),
  ]);
  const saved = JSON.parse(readFileSync(join(dir, 'task-tools.json'), 'utf8')).clickup;
  assert.equal(saved.workspaceId, '902');
  assert.equal(saved.token, TOKEN);
});

test('a fetch still running when you disconnect doesn\'t bring the old tasks back', async () => {
  const pending = [];
  const clickupFor = () => ({
    user: async () => ({ id: 7, username: 'dev' }),
    workspaces: async () => [{ id: '901', name: 'Acme' }],
    assignedTasks: () => new Promise((resolve) => { pending.push(() => resolve([TASK])); }),
  });
  const service = createTaskTools({ store: memoryStore(), clickupFor });
  await service.connect({ tool: 'clickup', token: TOKEN });
  const slow = service.tasks();
  await new Promise((r) => setImmediate(r));
  await service.disconnect({ tool: 'clickup' });
  await service.connect({ tool: 'clickup', token: TOKEN });
  pending.shift()();
  await slow;
  // The new connection asks ClickUp itself rather than being served what the old one fetched.
  const next = service.tasks();
  await new Promise((r) => setImmediate(r));
  assert.equal(pending.length, 1);
  pending.shift()();
  await next;
});

test('an old list is shown at once while a fresh one is fetched behind it', async () => {
  let now = 1_000;
  let release = null;
  let calls = 0;
  const clickupFor = () => ({
    user: async () => ({ id: 7, username: 'dev' }),
    workspaces: async () => [{ id: '901', name: 'Acme' }],
    assignedTasks: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve([{ ...TASK, name: 'old' }]);
      return new Promise((resolve) => { release = () => resolve([{ ...TASK, name: 'new' }]); });
    },
  });
  const service = createTaskTools({ store: memoryStore(), clickupFor, ttlMs: 60_000, now: () => now });
  await service.connect({ tool: 'clickup', token: TOKEN });
  await service.tasks();
  now += 61_000;
  const stale = await service.tasks();
  assert.equal(stale.tasks[0].name, 'old', 'answered without waiting for ClickUp');
  await service.tasks();
  assert.equal(calls, 2, 'one background fetch, however often it is asked meanwhile');
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal((await service.tasks()).tasks[0].name, 'new');
});
