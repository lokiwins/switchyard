import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSessionGraphs } from '../src/session-graphs.js';

const SESSION = '0b6c3c1e-8a52-4a8e-9a43-0c5c1f3e2d11';
const CWD = '/w/shop';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'sy-graph-'));
  const claudeDir = join(home, '.claude');
  const dir = join(claudeDir, 'projects', '-w-shop');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${SESSION}.jsonl`);
  const graphs = createSessionGraphs({ claudeDir, home, pollMs: 10 });
  return { home, claudeDir, dir, file, graphs };
}

let seq = 0;
const line = (entry) => `${JSON.stringify({ uuid: `u${++seq}`, cwd: CWD, ...entry })}\n`;
const prompt = (text) => line({ type: 'user', message: { role: 'user', content: text } });
const read = (id, path) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] } });
const ids = (graph) => graph.nodes.map((n) => n.id);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await wait(10);
  }
  return false;
}

test('snapshot builds a session\'s graph from its transcript, labelling files from its folder', async () => {
  const { file, graphs } = setup();
  writeFileSync(file, prompt('Fix it') + read('t1', '/w/shop/src/a.js'));
  const graph = await graphs.snapshot(SESSION);
  assert.equal(graph.sessionId, SESSION);
  assert.equal(graph.cwd, CWD);
  assert.equal(graph.nodes.find((n) => n.id === 'file:/w/shop/src/a.js').label, 'src/a.js');
});

test('an id that is not a session id is refused before touching the disk', async () => {
  const { graphs } = setup();
  await assert.rejects(graphs.snapshot('../../etc/passwd'), { status: 400 });
});

test('an unknown session is not found', async () => {
  const { graphs } = setup();
  await assert.rejects(graphs.snapshot('11111111-2222-4333-8444-555555555555'), { status: 404 });
});

test('subscribers get the graph at once, then again as the transcript grows', async () => {
  const { file, graphs } = setup();
  writeFileSync(file, prompt('First'));
  const seen = [];
  const stop = await graphs.subscribe(SESSION, (graph) => seen.push(graph));
  try {
    assert.equal(seen.length, 1);
    appendFileSync(file, read('t1', '/w/shop/b.js'));
    assert.ok(await until(() => seen.at(-1)?.nodes.some((n) => n.id === 'file:/w/shop/b.js')), 'the new read never showed up');
  } finally {
    stop();
  }
});

test('nothing is sent when the transcript has not changed', async () => {
  const { file, graphs } = setup();
  writeFileSync(file, prompt('Quiet'));
  const seen = [];
  const stop = await graphs.subscribe(SESSION, (graph) => seen.push(graph));
  await wait(80);
  stop();
  assert.equal(seen.length, 1);
});

test('a line written in two parts is read once it is whole', async () => {
  const { file, graphs } = setup();
  writeFileSync(file, prompt('Start'));
  const seen = [];
  const stop = await graphs.subscribe(SESSION, (graph) => seen.push(graph));
  try {
    const whole = read('t1', '/w/shop/split.js');
    appendFileSync(file, whole.slice(0, 20));
    await wait(50);
    assert.ok(!seen.at(-1).nodes.some((n) => n.id === 'file:/w/shop/split.js'));
    appendFileSync(file, whole.slice(20));
    assert.ok(await until(() => seen.at(-1).nodes.some((n) => n.id === 'file:/w/shop/split.js')));
  } finally {
    stop();
  }
});

test('subagents are read from the session\'s subagents folder, joined to their Agent call', async () => {
  const { dir, file, graphs } = setup();
  writeFileSync(file, prompt('Review') + line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_5', name: 'Agent', input: { description: 'Review the diff' } }] } }));
  const seen = [];
  const stop = await graphs.subscribe(SESSION, (graph) => seen.push(graph));
  try {
    const subagents = join(dir, SESSION, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'code-reviewer', description: 'Review the diff', toolUseId: 'toolu_5' }));
    writeFileSync(join(subagents, 'agent-a1.jsonl'), line({ type: 'user', isSidechain: true, message: { content: 'Review' } }) + read('s1', '/w/shop/src/a.js'));
    assert.ok(await until(() => seen.at(-1).edges.some((e) => e.source === 'agent:toolu_5' && e.target === 'file:/w/shop/src/a.js')));
    assert.equal(seen.at(-1).nodes.find((n) => n.id === 'agent:toolu_5').group, 'code-reviewer');
  } finally {
    stop();
  }
});

test('two pages on one session share one reader, which stops when both leave', async () => {
  const { file, graphs } = setup();
  writeFileSync(file, prompt('Shared'));
  const stopA = await graphs.subscribe(SESSION, () => {});
  const stopB = await graphs.subscribe(SESSION, () => {});
  assert.equal(graphs.watching(), 1);
  stopA();
  assert.equal(graphs.watching(), 1);
  stopB();
  assert.equal(graphs.watching(), 0);
  assert.deepEqual(ids(await graphs.snapshot(SESSION)).filter((id) => id.startsWith('prompt:')).length, 1);
});
