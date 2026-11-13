import { basename } from 'node:path';
import { isHumanPrompt, promptText } from './claude-transcript.js';
import { contextSize, estimateTokens } from './context-tokens.js';

/*
 * A session's context as a graph: your prompts in order (the spine), and what
 * each one brought into Claude's context — files read or changed, tools used,
 * memory and instruction files loaded, skills invoked, subagents spawned (with
 * what they in turn touched). Compactions sit in the spine; whatever was last
 * used before the latest one is marked out of context.
 *
 * Each node also carries the tokens it put into the main conversation's
 * context (estimated, see context-tokens.js): over the whole session, and
 * since the latest compaction ("live"). What a subagent reads stays in its own
 * context; only its call and its answer reach the main one.
 *
 * The builder folds transcript entries in one at a time, so a live session's
 * graph grows from the lines appended since the last read.
 */

const LABEL_CHARS = 60;
const DETAIL_CHARS = 600;
const SESSION_ID = 'session';
const LABEL_PATH_PARTS = 2;

// Tool calls that put a file into context, and how.
const FILE_TOOLS = {
  Read: { action: 'read', field: 'file_path' },
  Edit: { action: 'edit', field: 'file_path' },
  MultiEdit: { action: 'edit', field: 'file_path' },
  Write: { action: 'write', field: 'file_path' },
  NotebookEdit: { action: 'edit', field: 'notebook_path' },
};
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const MEMORY_GROUPS = { User: 'User', Project: 'Project', Local: 'Local', AutoMem: 'Auto memory', Managed: 'Managed' };
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

const flatten = (text) => text.replace(/\s+/g, ' ').trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @typedef {'session'|'prompt'|'compaction'|'file'|'tool'|'memory'|'skill'|'subagent'} NodeKind
 * @typedef {{ id: string, kind: NodeKind, label: string, detail: string|null, group: string|null, uses: number, inContext: boolean, tokens: number, liveTokens: number }} GraphNode
 * @typedef {{ session: Record<string, number>, live: Record<string, number>, context: number|null }} GraphTokens
 *   By node kind, plus 'reply' for Claude's own text; context is the last main API call's input as reported.
 * @typedef {{ id: string, source: string, target: string, kind: string, count: number }} GraphEdge
 * @typedef {{ title: string|null, cwd: string|null, compactions: number, nodes: GraphNode[], edges: GraphEdge[], tokens: GraphTokens }} SessionGraph
 */

/**
 * @param {{ cwd: string|null, home: string, claudeDir: string }} where
 *   cwd shortens file labels (taken from the transcript when null); files under
 *   claudeDir/projects/<x>/memory count as memory.
 */
export function createGraphBuilder({ cwd: knownCwd = null, home, claudeDir }) {
  // Learnt from the transcript itself when not given: its entries carry the session's folder.
  let cwd = knownCwd;
  const nodes = new Map();
  const edges = new Map();
  const memoryDir = `${claudeDir}/projects/`;
  // Where the main conversation is: the node new things hang off, and the last spine node.
  const main = { source: SESSION_ID, spineTail: SESSION_ID };
  let tick = 0;
  let compactedAt = -1;
  let compactions = 0;
  let title = null;
  let lastCompaction = null;
  const spineCount = { prompt: 0, compaction: 0 };
  let context = null;
  // Tool calls in the main conversation still waiting on their result: id → the node the result belongs to.
  const pendingResults = new Map();
  const totals = { session: {}, live: {} };

  function shortPath(path) {
    if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
    if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
    // Elsewhere (a temp folder, another drive), the last folder and the name; the detail keeps the full path.
    const parts = path.split('/').filter(Boolean);
    return parts.length > LABEL_PATH_PARTS ? `…/${parts.slice(-LABEL_PATH_PARTS).join('/')}` : path;
  }

  /** The node, created on first sight; every sighting counts as a use and refreshes when it was last in context. */
  function touch(id, fields, { count = true } = {}) {
    const existing = nodes.get(id);
    const node = existing ?? { id, detail: null, group: null, uses: 0, lastTick: 0, tokens: 0, liveTokens: 0, ...fields };
    if (count) node.uses += 1;
    node.lastTick = tick;
    nodes.set(id, node);
    return node;
  }

  function addToTotals(kind, tokens) {
    totals.session[kind] = (totals.session[kind] ?? 0) + tokens;
    totals.live[kind] = (totals.live[kind] ?? 0) + tokens;
  }

  /** Count tokens that reached the main context against a node (or, with no node, a kind such as 'reply'). */
  function addTokens(target, tokens, { inMain = true } = {}) {
    if (!inMain || tokens <= 0) return;
    if (typeof target === 'string') {
      addToTotals(target, tokens);
      return;
    }
    target.tokens += tokens;
    target.liveTokens += tokens;
    addToTotals(target.kind, tokens);
  }

  function link(source, target, kind) {
    const id = `${source}→${target}:${kind}`;
    const existing = edges.get(id);
    edges.set(id, existing ? { ...existing, count: existing.count + 1 } : { id, source, target, kind, count: 1 });
  }

  function addToSpine(id) {
    link(main.spineTail, id, 'next');
    main.spineTail = id;
  }

  const isMemoryFile = (path) => path.startsWith(memoryDir) && path.includes('/memory/');

  function memoryNode(path, type) {
    return touch(`memory:${path}`, { kind: 'memory', label: shortPath(path), group: MEMORY_GROUPS[type] ?? type ?? null });
  }

  function fileNode(path, source, action) {
    const node = isMemoryFile(path)
      ? memoryNode(path, 'AutoMem')
      : touch(`file:${path}`, { kind: 'file', label: shortPath(path), detail: path });
    link(source, node.id, action);
    return node;
  }

  function toolNode(name, source) {
    const mcp = name.match(MCP_TOOL);
    if (!mcp) {
      const node = touch(`tool:${name}`, { kind: 'tool', label: name });
      link(source, node.id, 'used');
      return node;
    }
    const [, server, tool] = mcp;
    const node = touch(`tool:mcp:${server}`, { kind: 'tool', label: `${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')} (MCP)`, group: 'MCP' });
    const tools = new Set((node.detail ?? '').split(', ').filter(Boolean)).add(tool);
    node.detail = [...tools].join(', ');
    link(source, node.id, 'used');
    return node;
  }

  function skillNode(name, source) {
    const node = touch(`skill:${name}`, { kind: 'skill', label: name });
    link(source, node.id, 'invoked');
    return node;
  }

  function subagentNode(toolUseId, { description = null, agentType = null } = {}, { count = true } = {}) {
    const node = touch(`agent:${toolUseId}`, { kind: 'subagent', label: description ?? 'Subagent' }, { count });
    if (description) node.label = clip(flatten(description), LABEL_CHARS);
    if (agentType) node.group = agentType;
    return node;
  }

  /** The node a tool call goes to (creating and linking it), or null for a file call without a path. */
  function toolUseNode(part, source) {
    const input = part.input ?? {};
    const file = FILE_TOOLS[part.name];
    if (file) return typeof input[file.field] === 'string' ? fileNode(input[file.field], source, file.action) : null;
    if (part.name === 'Skill' && typeof input.skill === 'string') return skillNode(input.skill, source);
    if (AGENT_TOOLS.has(part.name) && part.id) {
      const node = subagentNode(part.id, { description: input.description, agentType: input.subagent_type });
      link(source, node.id, 'spawned');
      return node;
    }
    return toolNode(part.name, source);
  }

  /** A call is in context as Claude wrote it; its result is counted when it comes back. */
  function addToolUse(part, source, inMain) {
    const node = toolUseNode(part, source);
    if (!node || !inMain) return;
    addTokens(node, estimateTokens(part.input ?? {}));
    if (part.id) pendingResults.set(part.id, node);
  }

  function addToolResults(entry) {
    for (const part of entry.message.content) {
      if (part?.type !== 'tool_result' || !pendingResults.has(part.tool_use_id)) continue;
      addTokens(pendingResults.get(part.tool_use_id), estimateTokens(part.content));
      pendingResults.delete(part.tool_use_id);
    }
  }

  function addAttachment(attachment, source, inMain) {
    if (attachment.type === 'instructions') {
      for (const file of attachment.files ?? []) {
        const node = memoryNode(file.path, file.type);
        link(SESSION_ID, node.id, 'loaded');
        addTokens(node, estimateTokens(file.content), { inMain });
      }
    } else if (attachment.type === 'nested_memory' && attachment.path) {
      const node = memoryNode(attachment.path, attachment.content?.type);
      link(source, node.id, 'loaded');
      addTokens(node, estimateTokens(attachment.content?.content), { inMain });
    } else if (attachment.type === 'invoked_skills') {
      for (const skill of attachment.skills ?? []) {
        if (skill.name) addTokens(skillNode(skill.name, source), estimateTokens(skill.content), { inMain });
      }
    } else if (attachment.type === 'file' && attachment.filename) {
      const content = attachment.content?.file?.content ?? attachment.content;
      addTokens(fileNode(attachment.filename, source, 'attached'), estimateTokens(content), { inMain });
    }
  }

  function addPrompt(entry) {
    const text = flatten(promptText(entry.message.content));
    // Numbered in transcript order: the same transcript always gives the same ids (and so the same layout).
    const id = `prompt:${++spineCount.prompt}`;
    const node = touch(id, { kind: 'prompt', label: clip(text, LABEL_CHARS), detail: clip(text, DETAIL_CHARS) });
    addTokens(node, estimateTokens(promptText(entry.message.content)));
    addToSpine(id);
    main.source = id;
  }

  function addCompaction(entry) {
    compactions += 1;
    compactedAt = tick;
    const id = `compaction:${++spineCount.compaction}`;
    const before = entry.compactMetadata?.preTokens;
    // What was in context is gone; the summary that replaces it is counted against this node.
    for (const node of nodes.values()) node.liveTokens = 0;
    totals.live = {};
    pendingResults.clear();
    lastCompaction = touch(id, { kind: 'compaction', label: 'Compacted', detail: before ? `${Math.round(before / 1000)}k tokens before` : null });
    addToSpine(id);
    main.source = id;
  }

  /**
   * Fold one transcript entry in. `subagent` is the Agent tool call's id when
   * the entry comes from that subagent's own transcript.
   */
  function add(entry, { subagent = null } = {}) {
    if (!entry || typeof entry !== 'object') return;
    tick += 1;
    if (!cwd && !subagent && typeof entry.cwd === 'string') cwd = entry.cwd;
    if (entry.type === 'ai-title' && entry.aiTitle) title = entry.aiTitle;
    const source = subagent ? subagentNode(subagent, {}, { count: false }).id : main.source;
    if (!subagent && entry.type === 'system' && entry.subtype === 'compact_boundary') return addCompaction(entry);
    if (!subagent && isHumanPrompt(entry)) return addPrompt(entry);
    const inMain = !subagent && !entry.isSidechain;
    if (entry.type === 'attachment' && entry.attachment) return addAttachment(entry.attachment, source, inMain);
    if (inMain && entry.type === 'user' && entry.isCompactSummary) {
      addTokens(lastCompaction ?? 'compaction', estimateTokens(entry.message?.content));
      return undefined;
    }
    if (!Array.isArray(entry.message?.content)) return undefined;
    if (inMain && entry.type === 'user') return addToolResults(entry);
    if (entry.type !== 'assistant') return undefined;
    if (inMain) addReply(entry);
    for (const part of entry.message.content) if (part?.type === 'tool_use' && part.name) addToolUse(part, source, inMain);
    return undefined;
  }

  /** Claude's own text stays in context too; the call's reported usage says how full the context was. */
  function addReply(entry) {
    for (const part of entry.message.content) if (part?.type === 'text') addTokens('reply', estimateTokens(part.text ?? ''));
    context = contextSize(entry.message.usage) ?? context;
  }

  /** A subagent's description and type, from its .meta.json. */
  function addSubagentMeta(toolUseId, meta) {
    subagentNode(toolUseId, meta ?? {}, { count: false });
  }

  /** @returns {SessionGraph} */
  function snapshot() {
    const session = { id: SESSION_ID, kind: 'session', label: title ?? (cwd ? basename(cwd) : 'Session'), detail: cwd, group: null, uses: 1, inContext: true, tokens: 0, liveTokens: 0 };
    return {
      title,
      cwd,
      compactions,
      nodes: [session, ...[...nodes.values()].map(({ lastTick, ...node }) => ({ ...node, inContext: lastTick > compactedAt }))],
      edges: [...edges.values()].map((e) => ({ ...e })),
      tokens: { session: { ...totals.session }, live: { ...totals.live }, context },
    };
  }

  return { add, addSubagentMeta, snapshot };
}
