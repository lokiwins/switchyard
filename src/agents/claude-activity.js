import { basename } from 'node:path';

/*
 * What a Claude Code session is saying or doing, read from its transcript:
 * the last message it wrote to you, and the tool call a turn is in the
 * middle of. Both are more useful at a glance than the prompt you typed.
 */

const REPLY_PREVIEW_CHARS = 600;
const ACTIVITY_CHARS = 120;

const flatten = (value, max) => {
  const flat = String(value).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const quoted = (value) => `"${flatten(value, ACTIVITY_CHARS - 20)}"`;
const fileName = (input) => (input?.file_path || input?.notebook_path ? basename(input.file_path ?? input.notebook_path) : 'a file');

const TOOL_DESCRIPTIONS = {
  Bash: (input) => (input?.description ? input.description : `Running ${input?.command ?? 'a command'}`),
  Edit: (input) => `Editing ${fileName(input)}`,
  MultiEdit: (input) => `Editing ${fileName(input)}`,
  NotebookEdit: (input) => `Editing ${fileName(input)}`,
  Write: (input) => `Writing ${fileName(input)}`,
  Read: (input) => `Reading ${fileName(input)}`,
  Grep: (input) => `Searching for ${quoted(input?.pattern ?? '')}`,
  Glob: (input) => `Finding files matching ${quoted(input?.pattern ?? '')}`,
  Agent: (input) => `Subagent: ${input?.description ?? 'working'}`,
  Task: (input) => `Subagent: ${input?.description ?? 'working'}`,
  WebSearch: (input) => `Searching the web for ${quoted(input?.query ?? '')}`,
  WebFetch: (input) => `Reading ${safeHost(input?.url)}`,
  TodoWrite: () => 'Updating its to-do list',
  ToolSearch: () => 'Loading tools',
  AskUserQuestion: (input) => `Asking: ${input?.questions?.[0]?.question ?? 'a question'}`,
  ExitPlanMode: () => 'Waiting for you to approve its plan',
  Skill: (input) => (input?.skill ? `Using the ${input.skill} skill` : 'Using a skill'),
};

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'a web page';
  }
}

/** "mcp__claude_ai_Slack__slack_send_message" -> "slack send message (Slack)". */
function describeMcpTool(name) {
  const [, server = '', tool = ''] = name.split('__');
  const serverLabel = server.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${tool.replace(/_/g, ' ')} (${serverLabel})`;
}

/** A short, plain-English description of a tool call. */
export function describeTool(name, input) {
  const describe = TOOL_DESCRIPTIONS[name];
  if (describe) return flatten(describe(input ?? {}), ACTIVITY_CHARS);
  if (name.startsWith('mcp__')) return flatten(describeMcpTool(name), ACTIVITY_CHARS);
  return name;
}

const isMainChain = (entry) => !entry.isSidechain && !entry.isMeta && !entry.isCompactSummary;
const partsOf = (entry) => (Array.isArray(entry.message?.content) ? entry.message.content : []);

/** Markdown reads as noise in a one-line preview: keep link text, drop emphasis, code ticks, headings and bullets. */
export function stripMarkdown(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`+)/g, '')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?)/gm, '');
}

/** The last text Claude wrote in the main conversation, flattened for a one-line preview. */
export function lastReply(entries) {
  const reply = entries.findLast((e) => e.type === 'assistant' && isMainChain(e)
    && partsOf(e).some((p) => p.type === 'text' && p.text.trim()));
  if (!reply) return null;
  const text = partsOf(reply).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
  return flatten(stripMarkdown(text), REPLY_PREVIEW_CHARS);
}

/**
 * The tool call the current turn is busy with, or null when the turn is over.
 * A turn is mid-flight while its last entry is a tool call or a tool's result.
 */
export function currentActivity(entries) {
  const conversation = entries.filter((e) => (e.type === 'user' || e.type === 'assistant') && isMainChain(e));
  const last = conversation.at(-1);
  if (!last) return null;
  const inFlight = last.type === 'assistant'
    ? partsOf(last).some((p) => p.type === 'tool_use')
    : partsOf(last).some((p) => p.type === 'tool_result');
  if (!inFlight) return null;
  const call = conversation.flatMap(partsOf).findLast((p) => p.type === 'tool_use');
  return call ? describeTool(call.name, call.input) : null;
}
