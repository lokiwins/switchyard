import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphBuilder } from '../src/agents/session-graph.js';

const CWD = '/w/shop';
const HOME = '/home/dev';
const CLAUDE_DIR = `${HOME}/.claude`;

let seq = 0;
const stamp = () => ({ uuid: `u${++seq}`, timestamp: new Date(Date.UTC(2026, 10, 13, 12, 0, seq)).toISOString() });
const prompt = (text) => ({ type: 'user', ...stamp(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ type: 'assistant', ...stamp(), message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, extra = {}) => ({ type: 'user', ...stamp(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, ...extra });
const attachment = (value) => ({ type: 'attachment', ...stamp(), attachment: value });
const compact = () => ({ type: 'system', subtype: 'compact_boundary', ...stamp(), compactMetadata: { trigger: 'auto', preTokens: 180000 } });

function build(entries, subagents = []) {
  const builder = createGraphBuilder({ cwd: CWD, home: HOME, claudeDir: CLAUDE_DIR });
  for (const entry of entries) builder.add(entry);
  for (const { toolUseId, meta, entries: lines } of subagents) {
    builder.addSubagentMeta(toolUseId, meta);
    for (const entry of lines) builder.add(entry, { subagent: toolUseId });
  }
  return builder.snapshot();
}
const node = (graph, id) => graph.nodes.find((n) => n.id === id);
const edge = (graph, source, target) => graph.edges.find((e) => e.source === source && e.target === target);

test('prompts form a spine from the session, each linked to the next', () => {
  const graph = build([prompt('Add a retry to charges'), prompt('Now write the tests')]);
  const prompts = graph.nodes.filter((n) => n.kind === 'prompt');
  assert.deepEqual(prompts.map((n) => n.label), ['Add a retry to charges', 'Now write the tests']);
  assert.equal(edge(graph, 'session', prompts[0].id).kind, 'next');
  assert.equal(edge(graph, prompts[0].id, prompts[1].id).kind, 'next');
});

test('long prompts get a short label and keep the full text as detail', () => {
  const text = `Please ${'refactor the billing module '.repeat(10)}`;
  const [n] = build([prompt(text)]).nodes.filter((x) => x.kind === 'prompt');
  assert.ok(n.label.length <= 60 && n.label.endsWith('…'), n.label);
  assert.equal(n.detail, text.trim());
});

test('tool results, interruptions, slash-command output and meta entries are not prompts', () => {
  const graph = build([
    prompt('Real question'),
    toolResult('t1'),
    prompt('[Request interrupted by user]'),
    prompt('<local-command-stdout>ok</local-command-stdout>'),
    { ...prompt('injected'), isMeta: true },
  ]);
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'prompt').map((n) => n.label), ['Real question']);
});

test('Read, Edit and Write calls link the prompt to the file, by what was done and how often', () => {
  const graph = build([
    prompt('Fix the bug'),
    toolUse('t1', 'Read', { file_path: '/w/shop/src/charge.js' }),
    toolUse('t2', 'Read', { file_path: '/w/shop/src/charge.js' }),
    toolUse('t3', 'Edit', { file_path: '/w/shop/src/charge.js', old_string: 'a', new_string: 'b' }),
    toolUse('t4', 'Write', { file_path: '/w/shop/test/charge.test.js', content: 'x' }),
    toolUse('t5', 'NotebookEdit', { notebook_path: '/w/shop/notes.ipynb' }),
  ]);
  const file = node(graph, 'file:/w/shop/src/charge.js');
  assert.equal(file.kind, 'file');
  assert.equal(file.label, 'src/charge.js');
  assert.equal(file.uses, 3);
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  const links = graph.edges.filter((e) => e.source === promptId && e.target === file.id);
  assert.deepEqual(links.map((e) => [e.kind, e.count]).sort(), [['edit', 1], ['read', 2]]);
  assert.equal(edge(graph, promptId, 'file:/w/shop/test/charge.test.js').kind, 'write');
  assert.equal(edge(graph, promptId, 'file:/w/shop/notes.ipynb').kind, 'edit');
});

test('files outside the folder are shown from ~ or as full paths', () => {
  const graph = build([
    prompt('Look around'),
    toolUse('t1', 'Read', { file_path: '/home/dev/notes/todo.md' }),
    toolUse('t2', 'Read', { file_path: '/etc/hosts' }),
  ]);
  assert.equal(node(graph, 'file:/home/dev/notes/todo.md').label, '~/notes/todo.md');
  assert.equal(node(graph, 'file:/etc/hosts').label, '/etc/hosts');
});

test('a long path elsewhere is labelled by its folder and name, with the full path as detail', () => {
  const path = '/private/tmp/claude-501/scratch/e2e/graph.mjs';
  const file = node(build([prompt('Try it'), toolUse('t1', 'Write', { file_path: path, content: 'x' })]), `file:${path}`);
  assert.equal(file.label, '…/e2e/graph.mjs');
  assert.equal(file.detail, path);
});

test('other tools are one node per tool, MCP tools one per server, used by the prompt', () => {
  const graph = build([
    prompt('Check things'),
    toolUse('t1', 'Bash', { command: 'npm test' }),
    toolUse('t2', 'Bash', { command: 'git status' }),
    toolUse('t3', 'WebSearch', { query: 'cytoscape' }),
    toolUse('t4', 'mcp__claude_ai_Slack__slack_send_message', {}),
    toolUse('t5', 'mcp__claude_ai_Slack__slack_read_channel', {}),
  ]);
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  assert.equal(node(graph, 'tool:Bash').uses, 2);
  assert.equal(edge(graph, promptId, 'tool:Bash').count, 2);
  assert.equal(node(graph, 'tool:WebSearch').label, 'WebSearch');
  const slack = node(graph, 'tool:mcp:claude_ai_Slack');
  assert.equal(slack.label, 'Slack (MCP)');
  assert.equal(slack.uses, 2);
  assert.match(slack.detail, /slack_send_message/);
});

test('instructions and nested memory become memory nodes, by where they come from', () => {
  const graph = build([
    attachment({ type: 'instructions', files: [
      { path: '/home/dev/.claude/CLAUDE.md', type: 'User' },
      { path: '/w/shop/CLAUDE.md', type: 'Project' },
      { path: '/home/dev/.claude/projects/-w-shop/memory/MEMORY.md', type: 'AutoMem' },
    ] }),
    prompt('Go'),
    attachment({ type: 'nested_memory', path: '/w/shop/src/CLAUDE.md', content: { type: 'Project' } }),
  ]);
  assert.equal(node(graph, 'memory:/home/dev/.claude/CLAUDE.md').label, '~/.claude/CLAUDE.md');
  assert.equal(node(graph, 'memory:/home/dev/.claude/CLAUDE.md').group, 'User');
  assert.equal(node(graph, 'memory:/w/shop/CLAUDE.md').group, 'Project');
  assert.equal(node(graph, 'memory:/home/dev/.claude/projects/-w-shop/memory/MEMORY.md').group, 'Auto memory');
  assert.equal(edge(graph, 'session', 'memory:/w/shop/CLAUDE.md').kind, 'loaded');
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  assert.equal(edge(graph, promptId, 'memory:/w/shop/src/CLAUDE.md').kind, 'loaded');
});

test('instructions loaded again after a compaction are one node, not two', () => {
  const files = [{ path: '/w/shop/CLAUDE.md', type: 'Project' }];
  const graph = build([attachment({ type: 'instructions', files }), prompt('a'), compact(), attachment({ type: 'instructions', files })]);
  assert.equal(graph.nodes.filter((n) => n.kind === 'memory').length, 1);
});

test('reading or writing an auto-memory file counts as memory, not as a file', () => {
  const path = '/home/dev/.claude/projects/-w-shop/memory/roadmap.md';
  const graph = build([prompt('Remember this'), toolUse('t1', 'Write', { file_path: path, content: 'x' })]);
  assert.equal(node(graph, `memory:${path}`).group, 'Auto memory');
  assert.equal(node(graph, `file:${path}`), undefined);
});

test('skills come from the Skill tool and from invoked_skills, once each', () => {
  const graph = build([
    prompt('Ship it'),
    toolUse('t1', 'Skill', { skill: 'verify' }),
    attachment({ type: 'invoked_skills', skills: [{ name: 'verify', path: 'userSettings:verify' }, { name: 'tdd', path: 'userSettings:tdd' }] }),
  ]);
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'skill').map((n) => n.label).sort(), ['tdd', 'verify']);
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  assert.equal(edge(graph, promptId, 'skill:verify').kind, 'invoked');
});

test('@-mentioned files are attached to the prompt', () => {
  const graph = build([prompt('Look at @src/a.js'), attachment({ type: 'file', filename: '/w/shop/src/a.js' })]);
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  assert.equal(edge(graph, promptId, 'file:/w/shop/src/a.js').kind, 'attached');
});

test('subagents hang off the prompt that spawned them, with their own files and tools', () => {
  const graph = build(
    [prompt('Review it'), toolUse('toolu_9', 'Agent', { description: 'Review the diff', subagent_type: 'code-reviewer', prompt: 'Review' })],
    [{
      toolUseId: 'toolu_9',
      meta: { agentType: 'code-reviewer', description: 'Review the diff' },
      entries: [
        { ...prompt('Review'), isSidechain: true },
        { ...toolUse('s1', 'Read', { file_path: '/w/shop/src/charge.js' }), isSidechain: true },
        { ...toolUse('s2', 'Bash', { command: 'git diff' }), isSidechain: true },
      ],
    }],
  );
  const agent = node(graph, 'agent:toolu_9');
  assert.equal(agent.kind, 'subagent');
  assert.equal(agent.label, 'Review the diff');
  assert.equal(agent.group, 'code-reviewer');
  const promptId = graph.nodes.find((n) => n.kind === 'prompt').id;
  assert.equal(edge(graph, promptId, 'agent:toolu_9').kind, 'spawned');
  assert.equal(edge(graph, 'agent:toolu_9', 'file:/w/shop/src/charge.js').kind, 'read');
  assert.equal(edge(graph, 'agent:toolu_9', 'tool:Bash').kind, 'used');
  // The subagent's own prompt isn't one of yours.
  assert.equal(graph.nodes.filter((n) => n.kind === 'prompt').length, 1);
});

test('a subagent file read before its Agent call is seen still gets a node', () => {
  const graph = build([], [{ toolUseId: 'toolu_7', meta: { agentType: 'Explore', description: 'Find the routes' }, entries: [] }]);
  assert.equal(node(graph, 'agent:toolu_7').label, 'Find the routes');
});

test('a compaction is a spine node, and what was last used before it is out of context', () => {
  const graph = build([
    attachment({ type: 'instructions', files: [{ path: '/w/shop/CLAUDE.md', type: 'Project' }] }),
    prompt('First'),
    toolUse('t1', 'Read', { file_path: '/w/shop/old.js' }),
    toolUse('t2', 'Read', { file_path: '/w/shop/both.js' }),
    compact(),
    attachment({ type: 'instructions', files: [{ path: '/w/shop/CLAUDE.md', type: 'Project' }] }),
    prompt('Second'),
    toolUse('t3', 'Read', { file_path: '/w/shop/both.js' }),
  ]);
  const [first, second] = graph.nodes.filter((n) => n.kind === 'prompt');
  const boundary = graph.nodes.find((n) => n.kind === 'compaction');
  assert.ok(boundary);
  assert.equal(edge(graph, first.id, boundary.id).kind, 'next');
  assert.equal(edge(graph, boundary.id, second.id).kind, 'next');
  assert.equal(graph.compactions, 1);
  assert.equal(node(graph, 'file:/w/shop/old.js').inContext, false);
  assert.equal(node(graph, 'file:/w/shop/both.js').inContext, true);
  assert.equal(node(graph, 'memory:/w/shop/CLAUDE.md').inContext, true);
  assert.equal(first.inContext, false);
  assert.equal(second.inContext, true);
});

test('the snapshot carries the title, and nodes and edges are plain data', () => {
  const graph = build([{ type: 'ai-title', aiTitle: 'Retry charges' }, prompt('Go')]);
  assert.equal(graph.title, 'Retry charges');
  assert.equal(node(graph, 'session').kind, 'session');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(graph)));
});

test('a snapshot is a copy: adding more later does not change it', () => {
  const builder = createGraphBuilder({ cwd: CWD, home: HOME, claudeDir: CLAUDE_DIR });
  builder.add(prompt('One'));
  const before = builder.snapshot();
  builder.add(toolUse('t1', 'Bash', { command: 'ls' }));
  assert.equal(before.nodes.some((n) => n.id === 'tool:Bash'), false);
  assert.equal(builder.snapshot().nodes.some((n) => n.id === 'tool:Bash'), true);
});

test('tool calls before any prompt hang off the session', () => {
  const graph = build([toolUse('t1', 'Bash', { command: 'ls' })]);
  assert.equal(edge(graph, 'session', 'tool:Bash').kind, 'used');
});

test('without a folder given, file labels use the one the transcript records', () => {
  const builder = createGraphBuilder({ cwd: null, home: HOME, claudeDir: CLAUDE_DIR });
  builder.add({ ...prompt('Go'), cwd: '/w/shop' });
  builder.add(toolUse('t1', 'Read', { file_path: '/w/shop/src/a.js' }));
  const graph = builder.snapshot();
  assert.equal(graph.cwd, '/w/shop');
  assert.equal(graph.nodes.find((n) => n.id === 'file:/w/shop/src/a.js').label, 'src/a.js');
});
