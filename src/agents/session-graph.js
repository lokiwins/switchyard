import { basename } from 'node:path';
import { isHumanPrompt, promptText } from './claude-transcript.js';

/*
 * A session's context as a graph: your prompts in order (the spine), and what
 * each one brought into Claude's context — files read or changed, tools used,
 * memory and instruction files loaded, skills invoked, subagents spawned (with
 * what they in turn touched). Compactions sit in the spine; whatever was last
 * used before the latest one is marked out of context.
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
 * @typedef {{ id: string, kind: NodeKind, label: string, detail: string|null, group: string|null, uses: number, inContext: boolean }} GraphNode
 * @typedef {{ id: string, source: string, target: string, kind: string, count: number }} GraphEdge
 * @typedef {{ title: string|null, cwd: string|null, compactions: number, nodes: GraphNode[], edges: GraphEdge[] }} SessionGraph
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
    const node = existing ?? { id, detail: null, group: null, uses: 0, lastTick: 0, ...fields };
    if (count) node.uses += 1;
    node.lastTick = tick;
    nodes.set(id, node);
    return node;
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
  }

  function toolNode(name, source) {
    const mcp = name.match(MCP_TOOL);
    if (!mcp) {
      link(source, touch(`tool:${name}`, { kind: 'tool', label: name }).id, 'used');
      return;
    }
    const [, server, tool] = mcp;
    const node = touch(`tool:mcp:${server}`, { kind: 'tool', label: `${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')} (MCP)`, group: 'MCP' });
    const tools = new Set((node.detail ?? '').split(', ').filter(Boolean)).add(tool);
    node.detail = [...tools].join(', ');
    link(source, node.id, 'used');
  }

  function skillNode(name, source) {
    link(source, touch(`skill:${name}`, { kind: 'skill', label: name }).id, 'invoked');
  }

  function subagentNode(toolUseId, { description = null, agentType = null } = {}, { count = true } = {}) {
    const node = touch(`agent:${toolUseId}`, { kind: 'subagent', label: description ?? 'Subagent' }, { count });
    if (description) node.label = clip(flatten(description), LABEL_CHARS);
    if (agentType) node.group = agentType;
    return node;
  }

  function addToolUse(part, source) {
    const input = part.input ?? {};
    const file = FILE_TOOLS[part.name];
    if (file) {
      if (typeof input[file.field] === 'string') fileNode(input[file.field], source, file.action);
      return;
    }
    if (part.name === 'Skill' && typeof input.skill === 'string') {
      skillNode(input.skill, source);
      return;
    }
    if (AGENT_TOOLS.has(part.name) && part.id) {
      const node = subagentNode(part.id, { description: input.description, agentType: input.subagent_type });
      link(source, node.id, 'spawned');
      return;
    }
    toolNode(part.name, source);
  }

  function addAttachment(attachment, source) {
    if (attachment.type === 'instructions') {
      for (const file of attachment.files ?? []) link(SESSION_ID, memoryNode(file.path, file.type).id, 'loaded');
    } else if (attachment.type === 'nested_memory' && attachment.path) {
      link(source, memoryNode(attachment.path, attachment.content?.type).id, 'loaded');
    } else if (attachment.type === 'invoked_skills') {
      for (const skill of attachment.skills ?? []) if (skill.name) skillNode(skill.name, source);
    } else if (attachment.type === 'file' && attachment.filename) {
      fileNode(attachment.filename, source, 'attached');
    }
  }

  function addPrompt(entry) {
    const text = flatten(promptText(entry.message.content));
    const id = `prompt:${entry.uuid ?? tick}`;
    touch(id, { kind: 'prompt', label: clip(text, LABEL_CHARS), detail: clip(text, DETAIL_CHARS) });
    addToSpine(id);
    main.source = id;
  }

  function addCompaction(entry) {
    compactions += 1;
    compactedAt = tick;
    const id = `compaction:${entry.uuid ?? tick}`;
    const before = entry.compactMetadata?.preTokens;
    touch(id, { kind: 'compaction', label: 'Compacted', detail: before ? `${Math.round(before / 1000)}k tokens before` : null });
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
    if (entry.type === 'attachment' && entry.attachment) return addAttachment(entry.attachment, source);
    if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) return undefined;
    for (const part of entry.message.content) if (part?.type === 'tool_use' && part.name) addToolUse(part, source);
    return undefined;
  }

  /** A subagent's description and type, from its .meta.json. */
  function addSubagentMeta(toolUseId, meta) {
    subagentNode(toolUseId, meta ?? {}, { count: false });
  }

  /** @returns {SessionGraph} */
  function snapshot() {
    const session = { id: SESSION_ID, kind: 'session', label: title ?? (cwd ? basename(cwd) : 'Session'), detail: cwd, group: null, uses: 1, inContext: true };
    return {
      title,
      cwd,
      compactions,
      nodes: [session, ...[...nodes.values()].map(({ lastTick, ...node }) => ({ ...node, inContext: lastTick > compactedAt }))],
      edges: [...edges.values()].map((e) => ({ ...e })),
    };
  }

  return { add, addSubagentMeta, snapshot };
}
