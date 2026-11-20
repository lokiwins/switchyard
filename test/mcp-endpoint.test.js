import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { ActionError } from '../src/errors.js';
import { ACTION_TOOLS, READ_TOOLS, createMcpEndpoint } from '../src/mcp-endpoint.js';

const TOKEN = 'sy-lead01.good';
const calls = [];
const endpoint = createMcpEndpoint({
  leadFrom: async (header) => (header === `Bearer ${TOKEN}` ? 'sy-lead01' : null),
  toolsFor: (lead) => ({
    startWorker: async (args) => {
      calls.push({ lead, args });
      if (args.title === 'fail') throw new ActionError(409, 'The worktree is there already');
      return { id: 'sy-wrk001', title: args.title };
    },
    listWorkers: async () => [{ id: 'sy-wrk001', state: 'working', lead }],
    workerStatus: async (args) => { calls.push({ lead, status: args }); return { id: args.id, state: 'idle' }; },
    messageWorker: async (args) => { calls.push({ lead, message: args }); return { sent: true }; },
    endWorker: async (args) => { calls.push({ lead, end: args }); return { ended: ['abc'] }; },
  }),
});

let server;
let url;
before(async () => {
  server = createServer((req, res) => endpoint.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(() => server.close());

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` };
let nextId = 0;
async function rpc(method, params = {}, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { ...HEADERS, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: nextId += 1, method, params }) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
const toolText = (body) => JSON.parse(body.result.content[0].text);

test('it answers MCP: initialize, then the lead\'s tools', async () => {
  const init = await rpc('initialize', INIT);
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'switchyard');
  const { body } = await rpc('tools/list');
  assert.deepEqual(body.result.tools.map((t) => t.name).sort(), ['end_worker', 'list_workers', 'message_worker', 'start_worker', 'worker_status']);
  for (const name of ['worker_status', 'message_worker', 'end_worker']) {
    assert.ok(body.result.tools.find((t) => t.name === name).inputSchema.required.includes('id'), name);
  }
  const start = body.result.tools.find((t) => t.name === 'start_worker');
  assert.deepEqual(start.inputSchema.required, ['title']);
});

test('every tool is either a read (marked read-only) or an action, so the lead\'s permissions cover each one', async () => {
  const { body } = await rpc('tools/list');
  const names = body.result.tools.map((t) => t.name).sort();
  assert.deepEqual([...READ_TOOLS, ...ACTION_TOOLS].sort(), names);
  assert.deepEqual([...READ_TOOLS].sort(), ['list_workers', 'worker_status']);
  for (const tool of body.result.tools) {
    assert.equal(tool.annotations?.readOnlyHint === true, READ_TOOLS.includes(tool.name), tool.name);
  }
});

test('the tools act for the lead the token names', async () => {
  const listed = await rpc('tools/call', { name: 'list_workers', arguments: {} });
  assert.deepEqual(toolText(listed.body), [{ id: 'sy-wrk001', state: 'working', lead: 'sy-lead01' }]);
  const started = await rpc('tools/call', { name: 'start_worker', arguments: { title: 'Write the tests', notes: 'Only totals' } });
  assert.deepEqual(toolText(started.body), { id: 'sy-wrk001', title: 'Write the tests' });
  assert.deepEqual(calls.at(-1), { lead: 'sy-lead01', args: { title: 'Write the tests', notes: 'Only totals' } });
});

test('a refusal comes back as the tool\'s error, in words, for the lead to read', async () => {
  const { body } = await rpc('tools/call', { name: 'start_worker', arguments: { title: 'fail' } });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /worktree is there already/);
});

test('bad arguments are refused before the tool runs', async () => {
  const before = calls.length;
  const { body } = await rpc('tools/call', { name: 'start_worker', arguments: { title: '' } });
  assert.ok(body.error || body.result?.isError, JSON.stringify(body));
  assert.equal(calls.length, before);
});

test('without the lead\'s token, nothing', async () => {
  for (const auth of [undefined, 'Bearer wrong']) {
    const headers = { ...HEADERS };
    if (auth) headers.Authorization = auth; else delete headers.Authorization;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(res.status, 401, String(auth));
  }
});

test('a browser (anything sending Origin) is refused, even with the token', async () => {
  const { status } = await rpc('tools/list', {}, { Origin: 'http://127.0.0.1:4477' });
  assert.equal(status, 403);
});

test('only POST: there is no stream to open', async () => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'text/event-stream' } });
  assert.equal(res.status, 405);
});

test('an oversized body is refused', async () => {
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(2_000_000) } }) });
  assert.equal(res.status, 413);
});

test('worker_status, message_worker and end_worker pass the worker\'s id (and the message) to the lead\'s tools', async () => {
  assert.deepEqual(toolText((await rpc('tools/call', { name: 'worker_status', arguments: { id: 'sy-wrk001' } })).body), { id: 'sy-wrk001', state: 'idle' });
  await rpc('tools/call', { name: 'message_worker', arguments: { id: 'sy-wrk001', text: 'Round half up.' } });
  await rpc('tools/call', { name: 'end_worker', arguments: { id: 'sy-wrk001' } });
  assert.deepEqual(calls.slice(-3), [
    { lead: 'sy-lead01', status: { id: 'sy-wrk001' } },
    { lead: 'sy-lead01', message: { id: 'sy-wrk001', text: 'Round half up.' } },
    { lead: 'sy-lead01', end: { id: 'sy-wrk001' } },
  ]);
});

test('a worker id that isn\'t one is refused before the tool runs', async () => {
  const before = calls.length;
  const { body } = await rpc('tools/call', { name: 'end_worker', arguments: { id: '../x' } });
  assert.ok(body.error || body.result?.isError, JSON.stringify(body));
  assert.equal(calls.length, before);
});
