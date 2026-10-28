import { open } from 'node:fs/promises';

const TAIL_BYTES = 256 * 1024;
const SCAN_CHUNK_BYTES = 1024 * 1024;
const MAX_PROMPT_SCAN_BYTES = 64 * 1024 * 1024;
const PROMPT_PREVIEW_CHARS = 600;
const INTERRUPT_PREFIX = '[Request interrupted by user';
const EXIT_COMMAND = /<command-name>\/(exit|quit)<\/command-name>/;
const LOCAL_COMMAND = /^<(local-command-stdout|command-name)>/;

/**
 * How a session's last turn ended:
 * - interrupted: the process died mid-turn (unanswered prompt, tool call or tool result)
 * - stopped: you pressed Esc to interrupt the agent
 * - exited: you ran /exit or /quit
 * - finished: the agent completed its turn
 * - unknown: no conversation found in the tail of the transcript
 * @typedef {'interrupted'|'stopped'|'exited'|'finished'|'unknown'} EndState
 */

/** Claude Code stores transcripts under projects/<cwd with non-alphanumerics replaced by "-">. */
export function transcriptDirName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((part) => part.type === 'tool_result')) return null;
  const text = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  return text || null;
}

function isHumanPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false;
  if (entry.origin && entry.origin.kind !== 'human') return false;
  const text = promptText(entry.message?.content);
  return Boolean(text) && !text.startsWith('<') && !text.startsWith(INTERRUPT_PREFIX);
}

function isConversational(entry) {
  return (entry.type === 'user' || entry.type === 'assistant')
    && !entry.isSidechain && !entry.isMeta && !entry.isCompactSummary;
}

/** @returns {EndState} */
export function classifyEnding(entries) {
  const conversation = entries.filter(isConversational);
  const last = conversation.at(-1);
  if (!last) return 'unknown';

  const content = last.message?.content;
  const parts = Array.isArray(content) ? content : [];
  if (last.type === 'assistant') return parts.some((p) => p.type === 'tool_use') ? 'interrupted' : 'finished';
  if (parts.some((p) => p.type === 'tool_result')) return 'interrupted';

  const text = promptText(content) ?? '';
  if (text.startsWith(INTERRUPT_PREFIX)) return 'stopped';
  if (LOCAL_COMMAND.test(text)) {
    const recent = conversation.slice(-3).map((e) => promptText(e.message?.content) ?? '');
    return recent.some((t) => EXIT_COMMAND.test(t)) ? 'exited' : 'finished';
  }
  return isHumanPrompt(last) ? 'interrupted' : 'unknown';
}

function truncate(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseLines(lines) {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function previewPrompt(entry) {
  return entry ? truncate(promptText(entry.message.content), PROMPT_PREVIEW_CHARS) : null;
}

/** Pull prompt, titles, location, activity time, linked PRs and end state out of transcript lines. */
export function summarizeTranscript(lines) {
  const entries = parseLines(lines);
  const lastOf = (predicate) => entries.findLast(predicate);
  const lastStamped = lastOf((e) => e.timestamp);
  const prLinks = entries.filter((e) => e.type === 'pr-link').map((e) => ({ number: e.prNumber, url: e.prUrl }));
  return {
    lastPrompt: previewPrompt(lastOf(isHumanPrompt)),
    lastActivityAt: lastStamped ? Date.parse(lastStamped.timestamp) : null,
    gitBranch: lastOf((e) => e.gitBranch)?.gitBranch ?? null,
    cwd: lastOf((e) => e.cwd)?.cwd ?? null,
    title: lastOf((e) => e.type === 'ai-title')?.aiTitle ?? null,
    agentName: lastOf((e) => e.type === 'agent-name')?.agentName ?? null,
    prLinks: [...new Map(prLinks.map((pr) => [pr.number, pr])).values()],
    endState: classifyEnding(entries),
  };
}

async function readRange(handle, start, end) {
  const { buffer, bytesRead } = await handle.read(Buffer.alloc(end - start), 0, end - start, start);
  return buffer.subarray(0, bytesRead);
}

async function readTailLines(handle, size) {
  const start = Math.max(0, size - TAIL_BYTES);
  const lines = (await readRange(handle, start, size)).toString('utf8').split('\n');
  return start > 0 ? lines.slice(1) : lines;
}

/**
 * Walk the file backwards in chunks looking for a matching entry. Lines are
 * split on raw bytes so multi-byte characters never straddle a chunk.
 */
async function findLastBackwards(handle, size, { marker, predicate }) {
  let carry = Buffer.alloc(0);
  const floor = Math.max(0, size - MAX_PROMPT_SCAN_BYTES);
  for (let end = size; end > floor; end -= SCAN_CHUNK_BYTES) {
    const start = Math.max(floor, end - SCAN_CHUNK_BYTES);
    const buffer = Buffer.concat([await readRange(handle, start, end), carry]);
    const firstNewline = start > floor ? buffer.indexOf(10) : -1;
    carry = firstNewline >= 0 ? buffer.subarray(0, firstNewline) : Buffer.alloc(0);
    const lines = buffer.subarray(firstNewline + 1).toString('utf8').split('\n').filter((line) => line.includes(marker));
    const found = parseLines(lines).findLast(predicate);
    if (found) return found;
  }
  return null;
}

/** Summarize a transcript file, scanning further back only for fields the tail lacks. */
export async function summarizeFile(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const summary = summarizeTranscript(await readTailLines(handle, size));
    const before = Math.max(0, size - TAIL_BYTES);
    if (before === 0) return summary;
    const prompt = summary.lastPrompt ? null
      : await findLastBackwards(handle, before, { marker: '"type":"user"', predicate: isHumanPrompt });
    const title = summary.title ? null
      : await findLastBackwards(handle, before, { marker: '"type":"ai-title"', predicate: (e) => e.type === 'ai-title' });
    return {
      ...summary,
      lastPrompt: summary.lastPrompt ?? previewPrompt(prompt),
      title: summary.title ?? title?.aiTitle ?? null,
    };
  } finally {
    await handle.close();
  }
}
