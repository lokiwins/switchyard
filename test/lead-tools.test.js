import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLeadTools, MAX_OPEN_WORKERS, workerState } from '../src/lead-tools.js';
import { createTaskHub } from '../src/task-hub.js';

const LEAD = 'sy-lead01';
const memoryFile = (data) => {
  let saved = data;
  return { read: async () => structuredClone(saved), write: async (next) => { saved = next; } };
};
const hubTask = (id, overrides = {}) => ({
  id, title: `Task ${id}`, notes: '', dueOn: null, links: [], createdAt: 1, updatedAt: 1, closedAs: null, closedAt: null, ...overrides,
});
const session = (overrides = {}) => ({ sessionId: 's-1', status: 'busy', needsYou: false, ...overrides });
const worktree = (path, branch, live = []) => ({ path, branch, isMain: false, agents: { live, recent: [] } });
const repo = (name, worktrees = []) => ({ name, mainPath: `/code/${name}`, worktrees: [{ path: `/code/${name}`, branch: 'main', isMain: true }, ...worktrees] });

function setup({
  tasks = [hubTask(LEAD)], repos = [repo('shop', [worktree('/code/shop-lead', `${LEAD}-build-it`)]), repo('web')], failStart = false, checks = {},
} = {}) {
  let ids = 0;
  const taskHub = createTaskHub({ file: memoryFile({ tasks }), newId: () => `sy-wrk${String(ids += 1).padStart(3, '0')}` });
  const starts = [];
  const startOptions = [];
  const hubStarter = {
    start: async (body, options) => {
      starts.push(body);
      startOptions.push(options);
      if (failStart) throw Object.assign(new Error('The worktree is there already'), { status: 409 });
      return { path: `/code/shop-${body.id}`, branch: `${body.id}-work`, window: 'shop-w' };
    },
  };
  const acted = [];
  const actions = {
    replyToSession: async (body) => { acted.push(['reply', body]); return { queued: false }; },
    endSession: async (body) => { acted.push(['end', body]); return { ended: true }; },
  };
  const reports = [];
  const gitReport = async (args) => { reports.push(args); return { base: args.base, commits: [], changes: null, uncommitted: [] }; };
  const tools = createLeadTools({
    taskHub, hubStarter, getRepos: async () => repos, actions, checkResults: async () => checks, gitReport,
  });
  return { tools, taskHub, starts, startOptions, acted, reports };
}

test('start_worker adds a subtask under the lead\'s task and starts it in the lead\'s repo', async () => {
  const { tools, taskHub, starts } = setup();
  const result = await tools.forLead(LEAD).startWorker({ title: 'Write the totals tests', notes: 'Only the totals.' });
  const made = (await taskHub.list()).find((t) => t.title === 'Write the totals tests');
  assert.equal(made.parentId, LEAD);
  assert.equal(made.notes, 'Only the totals.');
  // In the lead's repo: hub-start then begins it from the lead's branch there.
  assert.deepEqual(starts, [{ id: made.id, repo: '/code/shop' }]);
  assert.deepEqual(result, { id: made.id, title: 'Write the totals tests', repo: 'shop', branch: `${made.id}-work`, path: `/code/shop-${made.id}` });
});

test('start_worker can name another repo, by name', async () => {
  const { tools, starts } = setup();
  await tools.forLead(LEAD).startWorker({ title: 'Show the totals', repo: 'web' });
  assert.equal(starts[0].repo, '/code/web');
  await assert.rejects(tools.forLead(LEAD).startWorker({ title: 'X', repo: 'nope' }), (error) => error.status === 404 && /shop, web/.test(error.message));
});

test('start_worker needs a repo when the lead has no worktree to take it from', async () => {
  const { tools } = setup({ repos: [repo('shop'), repo('web')] });
  await assert.rejects(tools.forLead(LEAD).startWorker({ title: 'X' }), (error) => error.status === 400 && /repo/.test(error.message));
});

test('a worker that fails to start leaves no subtask behind, so a retry doesn\'t make two', async () => {
  const { tools, taskHub } = setup({ failStart: true });
  await assert.rejects(tools.forLead(LEAD).startWorker({ title: 'Write the tests' }), (error) => error.status === 409);
  assert.deepEqual((await taskHub.list()).map((t) => t.id), [LEAD]);
});

test('only an open, top-level task leads', async () => {
  const { tools } = setup({ tasks: [hubTask(LEAD, { closedAs: 'done' }), hubTask('sy-sub001', { parentId: 'sy-other' }), hubTask('sy-other')] });
  await assert.rejects(tools.forLead(LEAD).startWorker({ title: 'X' }), (error) => error.status === 409 && /done/.test(error.message));
  await assert.rejects(tools.forLead('sy-sub001').listWorkers(), (error) => error.status === 403);
  await assert.rejects(tools.forLead('sy-gone00').listWorkers(), (error) => error.status === 404);
});

test(`a lead has at most ${MAX_OPEN_WORKERS} open workers at once`, async () => {
  const workers = Array.from({ length: MAX_OPEN_WORKERS }, (_, i) => hubTask(`sy-open0${i}`, { parentId: LEAD }));
  const { tools, starts } = setup({ tasks: [hubTask(LEAD), ...workers, hubTask('sy-done00', { parentId: LEAD, closedAs: 'done' })] });
  await assert.rejects(tools.forLead(LEAD).startWorker({ title: 'One more' }), (error) => error.status === 409 && /at most/.test(error.message));
  assert.equal(starts.length, 0);
});

test('list_workers gives each of the lead\'s subtasks, with its worktree and what its session is doing', async () => {
  const tasks = [
    hubTask(LEAD),
    hubTask('sy-wrk001', { parentId: LEAD, title: 'Tests' }),
    hubTask('sy-wrk002', { parentId: LEAD, title: 'Docs', closedAs: 'done' }),
    hubTask('sy-else01', { parentId: 'sy-else00' }),
  ];
  const repos = [repo('shop', [
    worktree('/code/shop-lead', `${LEAD}-build`),
    worktree('/code/shop-tests', 'sy-wrk001-tests', [session({ sessionId: 'abc', status: 'idle', needsYou: true })]),
  ])];
  const { tools } = setup({ tasks, repos });
  assert.deepEqual(await tools.forLead(LEAD).listWorkers(), [
    {
      id: 'sy-wrk001', title: 'Tests', state: 'needs you', closedAs: null,
      worktrees: [{ repo: 'shop', branch: 'sy-wrk001-tests', path: '/code/shop-tests', sessions: [{ sessionId: 'abc', status: 'idle', needsYou: true }] }],
    },
    { id: 'sy-wrk002', title: 'Docs', state: 'done', closedAs: 'done', worktrees: [] },
  ]);
});

test('a worker\'s state, in a word or two', () => {
  const wt = (live) => [{ live }];
  assert.equal(workerState({ closedAs: 'dropped' }, []), 'dropped');
  assert.equal(workerState({ closedAs: null }, []), 'not started');
  assert.equal(workerState({ closedAs: null }, wt([])), 'no session');
  assert.equal(workerState({ closedAs: null }, wt([session()])), 'working');
  assert.equal(workerState({ closedAs: null }, wt([session({ status: 'idle' })])), 'idle');
  // Waiting on you beats busy elsewhere: the lead should say so, not wait.
  assert.equal(workerState({ closedAs: null }, [{ live: [session()] }, { live: [session({ status: 'idle', needsYou: true })] }]), 'needs you');
});

test('starts asked for at once still keep to the limit: they run one after another', async () => {
  const workers = Array.from({ length: MAX_OPEN_WORKERS - 1 }, (_, i) => hubTask(`sy-open0${i}`, { parentId: LEAD }));
  const { tools, starts } = setup({ tasks: [hubTask(LEAD), ...workers] });
  const lead = tools.forLead(LEAD);
  const results = await Promise.allSettled([lead.startWorker({ title: 'A' }), lead.startWorker({ title: 'B' })]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected']);
  assert.equal(starts.length, 1);
});

// A lead with a worker running in its repo, and a worker of another lead.
function withWorkers({ live = [session({ sessionId: 'abc', status: 'idle', lastReply: null })], checks = {} } = {}) {
  const tasks = [hubTask(LEAD), hubTask('sy-wrk001', { parentId: LEAD, title: 'Tests' }), hubTask('sy-other', { parentId: 'sy-else00' }), hubTask('sy-else00')];
  const repos = [repo('shop', [
    worktree('/code/shop-lead', `${LEAD}-build`),
    worktree('/code/shop-tests', 'sy-wrk001-tests', live),
    worktree('/code/shop-other', 'sy-other-x', [session({ sessionId: 'zzz' })]),
  ])];
  return setup({ tasks, repos, checks });
}

test('worker_status: its state, sessions with their last reply, and its work next to the lead\'s branch', async () => {
  const live = [session({ sessionId: 'abc', status: 'idle', transcript: { lastReply: 'Tests written; 2 fail on rounding.', activity: null } })];
  const { tools, reports } = withWorkers({ live, checks: { '/code/shop-tests': [{ name: 'test', state: 'failed', outOfDate: false, finishedAt: 5, trigger: 'manual', output: 'long…' }] } });
  const status = await tools.forLead(LEAD).workerStatus({ id: 'sy-wrk001' });
  assert.deepEqual(reports, [{ path: '/code/shop-tests', base: `${LEAD}-build` }]);
  assert.deepEqual(status, {
    id: 'sy-wrk001', title: 'Tests', state: 'idle', closedAs: null,
    worktrees: [{
      repo: 'shop', branch: 'sy-wrk001-tests', path: '/code/shop-tests',
      sessions: [{ sessionId: 'abc', status: 'idle', needsYou: false, lastReply: 'Tests written; 2 fail on rounding.', activity: null }],
      work: { base: `${LEAD}-build`, commits: [], changes: null, uncommitted: [] },
      checks: [{ name: 'test', state: 'failed', outOfDate: false }],
    }],
  });
});

test('worker_status in a repo the lead has no branch in compares with nothing, saying so', async () => {
  const tasks = [hubTask(LEAD), hubTask('sy-wrk001', { parentId: LEAD })];
  const repos = [repo('shop', [worktree('/code/shop-lead', `${LEAD}-build`)]), repo('web', [worktree('/code/web-w', 'sy-wrk001-x')])];
  const { tools, reports } = setup({ tasks, repos });
  await tools.forLead(LEAD).workerStatus({ id: 'sy-wrk001' });
  assert.deepEqual(reports, [{ path: '/code/web-w', base: null }]);
});

test('a lead can only see and act on its own workers', async () => {
  const { tools, acted } = withWorkers();
  const lead = tools.forLead(LEAD);
  for (const call of [() => lead.workerStatus({ id: 'sy-other' }), () => lead.messageWorker({ id: 'sy-other', text: 'hi' }), () => lead.endWorker({ id: 'sy-other' }), () => lead.workerStatus({ id: LEAD })]) {
    await assert.rejects(call(), (error) => error.status === 404 && /not one of your workers/.test(error.message));
  }
  assert.deepEqual(acted, []);
});

test('message_worker replies into the worker\'s running session, as Reply on the dashboard does', async () => {
  const { tools, acted } = withWorkers();
  const result = await tools.forLead(LEAD).messageWorker({ id: 'sy-wrk001', text: 'Round half up, then rerun.' });
  assert.deepEqual(acted, [['reply', { sessionId: 'abc', text: 'Round half up, then rerun.' }]]);
  assert.deepEqual(result, { sent: true, sessionId: 'abc', queued: false });
});

test('message_worker won\'t type over a prompt: that one is yours to answer', async () => {
  const { tools, acted } = withWorkers({ live: [session({ sessionId: 'abc', status: 'idle', needsYou: true })] });
  await assert.rejects(tools.forLead(LEAD).messageWorker({ id: 'sy-wrk001', text: 'Go on' }), (error) => error.status === 409 && /user/.test(error.message));
  assert.deepEqual(acted, []);
});

test('message_worker and end_worker need a running session', async () => {
  const { tools } = withWorkers({ live: [] });
  await assert.rejects(tools.forLead(LEAD).messageWorker({ id: 'sy-wrk001', text: 'Go' }), (error) => error.status === 409 && /no running session/.test(error.message));
  await assert.rejects(tools.forLead(LEAD).endWorker({ id: 'sy-wrk001' }), (error) => error.status === 409 && /no running session/.test(error.message));
});

test('end_worker ends its sessions and keeps its worktree, branch and subtask, so its work can still be merged', async () => {
  const { tools, acted, taskHub } = withWorkers({ live: [session({ sessionId: 'abc' }), session({ sessionId: 'def' })] });
  const result = await tools.forLead(LEAD).endWorker({ id: 'sy-wrk001' });
  assert.deepEqual(acted, [['end', { sessionId: 'abc' }], ['end', { sessionId: 'def' }]]);
  assert.deepEqual(result, { ended: ['abc', 'def'], kept: ['/code/shop-tests'] });
  assert.equal((await taskHub.list()).find((t) => t.id === 'sy-wrk001').closedAs, null);
});

test('a worker is started as a worker, so it gets the Workers settings', async () => {
  const { tools, startOptions } = setup();
  await tools.forLead(LEAD).startWorker({ title: 'Write the tests' });
  assert.deepEqual(startOptions, [{ worker: true }]);
});
