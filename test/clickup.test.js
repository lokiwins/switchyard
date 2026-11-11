import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertToken, createClickUp, normalizeTask } from '../src/clickup.js';

const TOKEN = 'pk_1234567_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const BASE = 'https://api.clickup.test/api/v2';

/** A fetch that answers from `routes` (path -> body or function of URL) and records each request. */
function fakeFetch(routes) {
  const requests = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, headers: init.headers, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    const route = routes[parsed.pathname.replace('/api/v2', '')];
    const answer = typeof route === 'function' ? route(parsed) : route;
    if (answer === undefined) return new Response('{"err":"Route not found"}', { status: 404 });
    if (answer instanceof Response) return answer;
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, requests };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

const rawTask = (fields = {}) => ({
  id: '86b1abc',
  custom_id: null,
  name: 'Show order history on the account page',
  status: { status: 'in progress', color: '#4194f6', type: 'custom' },
  priority: { priority: 'high', color: '#f8ae00' },
  due_date: '1767225600000',
  date_updated: '1767139200000',
  url: 'https://app.clickup.com/t/86b1abc',
  list: { id: '1', name: 'Sprint 12' },
  folder: { id: '2', name: 'Storefront', hidden: false },
  space: { id: '3' },
  description: 'Long text the list never shows',
  ...fields,
});

test('a personal token must look like one before it is sent anywhere', () => {
  assert.equal(assertToken(` ${TOKEN} `), TOKEN);
  for (const bad of ['', 'abc', 'Bearer pk_123', `${TOKEN}\nX-Other: 1`, 'pk_short', 42, null]) {
    assert.throws(() => assertToken(bad), (error) => error.status === 400);
  }
});

test('requests go to ClickUp with the token as the Authorization header', async () => {
  const { fetch, requests } = fakeFetch({ '/user': { user: { id: 7, username: 'dev', email: 'dev@example.com' } } });
  const user = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).user();
  assert.deepEqual(user, { id: 7, username: 'dev' });
  assert.equal(requests[0].url.href, `${BASE}/user`);
  assert.equal(requests[0].headers.Authorization, TOKEN);
});

test('workspaces are listed by id and name', async () => {
  const { fetch } = fakeFetch({ '/team': { teams: [{ id: '901', name: 'Acme', members: [{}] }, { id: '902', name: 'Side project' }] } });
  assert.deepEqual(await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).workspaces(), [
    { id: '901', name: 'Acme' }, { id: '902', name: 'Side project' },
  ]);
});

test('a refused token, rate limiting and other failures each say what happened', async () => {
  const answer = (status) => fakeFetch({ '/user': new Response('{"err":"Token invalid"}', { status }) }).fetch;
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: answer(401) }).user(), 401);
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: answer(429) }).user(), 429);
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: answer(500) }).user(), 502);
  const offline = async () => { throw new TypeError('fetch failed'); };
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: offline }).user(), 502);
});

test('assigned tasks: open ones assigned to you, subtasks included, most recently updated first', async () => {
  const { fetch, requests } = fakeFetch({ '/team/901/task': { tasks: [rawTask()], last_page: true } });
  const tasks = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).assignedTasks('901', 7);
  assert.equal(tasks.length, 1);
  const params = requests[0].url.searchParams;
  assert.deepEqual(params.getAll('assignees[]'), ['7']);
  assert.equal(params.get('include_closed'), 'false');
  assert.equal(params.get('subtasks'), 'true');
  assert.equal(params.get('order_by'), 'updated');
  assert.equal(params.get('page'), '0');
});

test('assigned tasks follow the pages, and stop at a cap', async () => {
  const page = (url) => ({ tasks: [rawTask({ id: `t${url.searchParams.get('page')}` })], last_page: false });
  const { fetch, requests } = fakeFetch({ '/team/901/task': page });
  const tasks = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch, maxPages: 3 }).assignedTasks('901', 7);
  assert.deepEqual(tasks.map((t) => t.id), ['t0', 't1', 't2']);
  assert.equal(requests.length, 3);
});

test('a done or closed task is left out even if ClickUp sends it', async () => {
  const done = rawTask({ id: 'd', status: { status: 'shipped', color: '#000', type: 'done' } });
  const closed = rawTask({ id: 'c', status: { status: 'closed', color: '#000', type: 'closed' } });
  const { fetch } = fakeFetch({ '/team/901/task': { tasks: [rawTask(), done, closed], last_page: true } });
  assert.deepEqual((await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).assignedTasks('901', 7)).map((t) => t.id), ['86b1abc']);
});

test('ids in a path are checked, so nothing else can be asked for', async () => {
  const { fetch, requests } = fakeFetch({});
  const clickup = createClickUp({ token: TOKEN, baseUrl: BASE, fetch });
  for (const id of ['../user', '901?x=1', '', null]) await rejectsWith(clickup.assignedTasks(id, 7), 400);
  assert.equal(requests.length, 0);
});

test('a task keeps what the list shows, with times as numbers and only safe colours and links', () => {
  assert.deepEqual(normalizeTask(rawTask()), {
    id: '86b1abc',
    customId: null,
    name: 'Show order history on the account page',
    status: { name: 'in progress', color: '#4194f6' },
    priority: 'high',
    dueAt: 1767225600000,
    updatedAt: 1767139200000,
    url: 'https://app.clickup.com/t/86b1abc',
    where: 'Storefront › Sprint 12',
  });
  const odd = normalizeTask(rawTask({
    custom_id: 'SHOP-12',
    status: { status: 'to do', color: 'red; background: url(x)', type: 'open' },
    priority: null,
    due_date: null,
    url: 'javascript:alert(1)',
    folder: { id: '2', name: 'hidden', hidden: true },
  }));
  assert.equal(odd.customId, 'SHOP-12');
  assert.equal(odd.status.color, null);
  assert.equal(odd.priority, null);
  assert.equal(odd.dueAt, null);
  assert.equal(odd.url, null);
  assert.equal(odd.where, 'Sprint 12');
});

test('tasks come back most recently updated first, whatever order ClickUp sends', async () => {
  const older = rawTask({ id: 'old', date_updated: '1000' });
  const newer = rawTask({ id: 'new', date_updated: '2000' });
  const { fetch } = fakeFetch({ '/team/901/task': { tasks: [older, newer], last_page: true } });
  const { tasks } = { tasks: await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).assignedTasks('901', 7) };
  assert.deepEqual(tasks.map((t) => t.id), ['new', 'old']);
});

test('a list cut off at the page cap says so', async () => {
  const full = () => ({ tasks: Array.from({ length: 100 }, (_, i) => rawTask({ id: `t${i}` })), last_page: false });
  const { fetch } = fakeFetch({ '/team/901/task': full });
  const tasks = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch, maxPages: 2 }).assignedTasks('901', 7);
  assert.equal(tasks.truncated, true);
  const { fetch: short } = fakeFetch({ '/team/901/task': { tasks: [rawTask()], last_page: true } });
  assert.equal((await createClickUp({ token: TOKEN, baseUrl: BASE, fetch: short }).assignedTasks('901', 7)).truncated, false);
});

test('an answer that isn\'t the JSON ClickUp sends is a 502, not a crash', async () => {
  const html = fakeFetch({ '/user': new Response('<html>maintenance</html>', { status: 200 }) }).fetch;
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: html }).user(), 502);
  const empty = fakeFetch({ '/user': {} }).fetch;
  await rejectsWith(createClickUp({ token: TOKEN, baseUrl: BASE, fetch: empty }).user(), 502);
});

test('after the first page, the rest are asked for together, and pages past the last are ignored', async () => {
  let inFlight = 0;
  let most = 0;
  const page = async (url) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const n = Number(url.searchParams.get('page'));
    return { tasks: n <= 2 ? [rawTask({ id: `t${n}`, date_updated: String(10 - n) })] : [], last_page: n >= 2 };
  };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(url.searchParams.get('page'));
    const body = await page(url);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const tasks = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch, maxPages: 6 }).assignedTasks('901', 7);
  assert.deepEqual(tasks.map((t) => t.id), ['t0', 't1', 't2']);
  assert.equal(tasks.truncated, false);
  assert.equal(requests[0], '0', 'the first page alone, to learn whether there are more');
  assert.ok(most > 1, 'later pages in parallel');
});

test('task: one ticket with its description and list, by task id', async () => {
  const { fetch, requests } = fakeFetch({ '/task/86b1abc': rawTask({ markdown_description: '## Goal\nShow **every** order.' }) });
  const ticket = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).task('86b1abc', '901');
  assert.deepEqual(ticket, {
    id: '86b1abc', customId: null, name: 'Show order history on the account page', status: { name: 'in progress', color: '#4194f6' },
    description: '## Goal\nShow **every** order.', url: 'https://app.clickup.com/t/86b1abc', listId: '1', listName: 'Sprint 12',
  });
  assert.equal(requests[0].url.searchParams.get('include_markdown_description'), 'true');
  assert.equal(requests[0].url.searchParams.get('custom_task_ids'), null);
});

test('task: a custom id like ENG-123 is looked up in the workspace', async () => {
  const { fetch, requests } = fakeFetch({ '/task/ENG-123': rawTask({ custom_id: 'ENG-123' }) });
  await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).task('ENG-123', '901');
  assert.equal(requests[0].url.searchParams.get('custom_task_ids'), 'true');
  assert.equal(requests[0].url.searchParams.get('team_id'), '901');
});

test('task: the description falls back to plain text, and is kept to a readable length', async () => {
  const { fetch } = fakeFetch({ '/task/86b1abc': rawTask({ description: 'x'.repeat(30_000) }) });
  const ticket = await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).task('86b1abc', '901');
  assert.equal(ticket.description.length, 20_000);
});

test('task: ids that could change the request path are refused before asking ClickUp', async () => {
  const { fetch, requests } = fakeFetch({});
  const clickup = createClickUp({ token: TOKEN, baseUrl: BASE, fetch });
  for (const bad of ['../team', 'a/b', '', 'x'.repeat(70), 'id?x=1']) await rejectsWith(clickup.task(bad, '901'), 400);
  assert.equal(requests.length, 0);
});

test('listStatuses: the statuses a ticket can move to, in the list\'s order', async () => {
  const { fetch } = fakeFetch({
    '/list/1': {
      id: '1',
      statuses: [
        { status: 'in progress', color: '#4194f6', type: 'custom', orderindex: 1 },
        { status: 'to do', color: '#87909e', type: 'open', orderindex: 0 },
        { status: 'complete', color: '#6bc950', type: 'closed', orderindex: 2 },
      ],
    },
  });
  assert.deepEqual(await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).listStatuses('1'), [
    { name: 'to do', color: '#87909e' }, { name: 'in progress', color: '#4194f6' }, { name: 'complete', color: '#6bc950' },
  ]);
});

test('setStatus: PUTs the new status on the task', async () => {
  const { fetch, requests } = fakeFetch({ '/task/86b1abc': rawTask({ status: { status: 'complete', color: '#6bc950' } }) });
  await createClickUp({ token: TOKEN, baseUrl: BASE, fetch }).setStatus('86b1abc', 'complete');
  assert.equal(requests[0].method, 'PUT');
  assert.deepEqual(requests[0].body, { status: 'complete' });
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
});
