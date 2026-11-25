import { readdir, readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { mapLimit } from '../exec.js';
import { endStateFrom } from '../session-events.js';
import { shellQuote, shellQuoteAlways } from '../shell.js';
import { lastReplyText, summarizeFile, transcriptDirName } from './claude-transcript.js';
import { createHostDetector } from './host.js';
import { createProcessStarts, isProcessAlive, startTimesMatch } from './process.js';
import { parseScreenPrompt } from './screen-prompt.js';

export { summarizeTranscript, transcriptDirName } from './claude-transcript.js';

const SUMMARY_CONCURRENCY = 8;
const DEFAULT_RECENT_LIMIT = 5;
// Only look this many transcripts deep for resumable ones, so busy folders stay cheap.
const RECENT_SCAN_FACTOR = 3;
// The registry can say "waiting" a moment before the dialog is drawn, so a screen without one
// is read once more if the session only just started waiting.
const SCREEN_RETRY_MS = 250;
const JUST_STARTED_WAITING_MS = 2_000;
// A plan bigger than this is left to the terminal.
const MAX_PLAN_BYTES = 256 * 1024;

/** A session that never got a prompt (opened, then /exit) has nothing to resume. */
const isResumable = (transcript) => Boolean(transcript?.lastPrompt) || transcript?.endState === 'interrupted';

// How Claude Code runs when Settings say nothing else.
// Full replies kept read (one per review agent shown on the PRs page), so a busy page doesn't reread transcripts.
const MAX_REPLIES_KEPT = 50;
const DEFAULT_RUN = Object.freeze({ program: 'claude', options: [] });
// A session id switchyard chooses for a session it starts (see review.js), typed as is.
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `claude --resume` only finds sessions recorded for the current directory.
 * `run` is how Claude is started: the program and any options Settings add.
 */
export function resumeCommand(cwd, sessionId, run = 'claude') {
  return `cd ${shellQuote(cwd)} && ${run} --resume ${sessionId}`;
}

/**
 * Claude Code's registry statuses, folded into the two the board sorts by
 * (busy = working, idle = waiting on you) plus why:
 * - waiting: a question or permission prompt is open, so it needs you now
 * - shell: the turn is over but a background command runs; Claude resumes by itself
 */
export function readStatus(registryStatus) {
  if (registryStatus === 'waiting') return { status: 'idle', needsYou: true, inBackground: false };
  if (registryStatus === 'shell') return { status: 'busy', needsYou: false, inBackground: true };
  return { status: registryStatus ?? 'unknown', needsYou: false, inBackground: false };
}

/**
 * What a session waiting on you is asking, read off its screen (see
 * screen-prompt.js); null for any other session, or if its screen can't be read.
 * `readScreen(host)` gives the text a host shows, or null for one it can't read.
 */
export async function readScreenPrompt(session, readScreen, { retryMs = SCREEN_RETRY_MS, now = Date.now() } = {}) {
  if (!readScreen || !session.needsYou || !session.host) return null;
  try {
    const prompt = parseScreenPrompt(await readScreen(session.host));
    const justStarted = now - (session.statusUpdatedAt ?? 0) < JUST_STARTED_WAITING_MS;
    if (prompt || !justStarted) return prompt;
    await delay(retryMs);
    return parseScreenPrompt(await readScreen(session.host));
  } catch {
    return null;
  }
}

/** A plan approval's plan, as Markdown, from its file in `plansDir`; null if it can't be read or is too big. */
export async function readPlan(plansDir, file) {
  if (!file) return null;
  try {
    const path = join(plansDir, file);
    if ((await stat(path)).size > MAX_PLAN_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * `readScreen(host)` gives the text a session's tmux pane or terminal tab
 * shows; without it, no screen prompts are read. `settings()` gives how to
 * run Claude, { program, options: [word…] } (see providers in settings.js),
 * read each time so a saved change applies at once.
 */
export function createClaudeProvider({
  claudeDir, listTmuxPanes, readScreen = null, settings = () => DEFAULT_RUN, home = homedir(),
  // How each session's last turn went, as its hooks told switchyard (see session-events.js): read over the transcript's guess.
  sessionEvents = { get: () => null },
}) {
  /** The program (with ~/ expanded) and options, as typed before anything else. Settings only allow plain words here. */
  function run() {
    const { program, options } = settings();
    const path = program.startsWith('~/') ? join(home, program.slice(2)) : program;
    return [path, ...options].join(' ');
  }
  /**
   * Start Claude Code, on `prompt` when given (quoted even when it looks safe: zsh expands a leading "="),
   * named, with a session id switchyard chose, in a permission mode and with a settings file and an MCP
   * config file, each when given; isolated, with only your own settings (not the folder's: its hooks, CLAUDE.md
   * and skills are someone else's) and no MCP servers but the config given. Those come after the
   * task, the MCP config last: --mcp-config takes several values, so anything after it would be read as one
   * more. The mode is one of a fixed list, checked by the caller (see tasks.js), so it's typed as is.
   */
  const launchCommand = (prompt, {
    name, sessionId, permissionMode, mcpConfig, settings, isolated = false,
  } = {}) => {
    if (sessionId !== undefined && !SESSION_UUID.test(sessionId)) throw new Error('A session id to start with must be a UUID');
    return [
      run(), prompt && shellQuoteAlways(prompt), name && `--name ${shellQuoteAlways(name)}`, sessionId && `--session-id ${sessionId}`,
      permissionMode && `--permission-mode ${permissionMode}`,
      settings && `--settings ${shellQuoteAlways(settings)}`, isolated && '--setting-sources user --strict-mcp-config',
      mcpConfig && `--mcp-config ${shellQuoteAlways(mcpConfig)}`,
    ].filter(Boolean).join(' ');
  };
  /** Resume one of its sessions, from the folder it ran in. */
  const resumeInPlace = (sessionId) => `${run()} --resume ${sessionId}`;
  const resumeHere = (cwd, sessionId) => resumeCommand(cwd, sessionId, run());

  const sessionsDir = join(claudeDir, 'sessions');
  const projectsDir = join(claudeDir, 'projects');
  const plansDir = join(claudeDir, 'plans');

  const detectHosts = createHostDetector({ listTmuxPanes });
  // Each session's process start time, asked of ps only for new pids (see process.js).
  const processStarts = createProcessStarts();
  const transcriptPath = (cwd, sessionId) => join(projectsDir, transcriptDirName(cwd), `${sessionId}.jsonl`);

  // Transcripts are append-only, so size identifies a summary's freshness.
  const summaries = new Map();
  // Last replies in full, by transcript, with the size they were read at (a review's report is read on every PRs page update);
  // the ones read longest ago go past MAX_REPLIES_KEPT.
  const replies = new Map();
  async function readReply(cwd, sessionId) {
    if (!SESSION_UUID.test(sessionId)) return null;
    const file = transcriptPath(cwd, sessionId);
    try {
      const { size } = await stat(file);
      const cached = replies.get(file);
      replies.delete(file);
      const text = cached?.size === size ? cached.text : await lastReplyText(file);
      replies.set(file, { size, text });
      if (replies.size > MAX_REPLIES_KEPT) replies.delete(replies.keys().next().value);
      return text;
    } catch {
      return null;
    }
  }

  async function summarize(file, knownSize) {
    try {
      const size = knownSize ?? (await stat(file)).size;
      const cached = summaries.get(file);
      const summary = cached?.size === size ? cached.summary : await summarizeFile(file);
      if (cached?.size !== size) summaries.set(file, { size, summary });
      return withEvents(basename(file, '.jsonl'), summary);
    } catch {
      return null;
    }
  }

  /** A summary with how its session ended taken from its recorded events, when it has some (events change; summaries are cached). */
  function withEvents(sessionId, summary) {
    const record = summary ? sessionEvents.get(sessionId) : null;
    if (!record) return summary;
    return { ...summary, endState: endStateFrom(record, summary.endState), endError: record.turn === 'failed' ? record.error : null };
  }

  async function readRegistryEntry(file) {
    try {
      return JSON.parse(await readFile(join(sessionsDir, file), 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Registry entries whose process is still running. A pid alone can be
   * reused by an unrelated process, so the recorded start time must match too.
   */
  async function runningEntries() {
    const files = (await readdir(sessionsDir).catch(() => [])).filter((f) => f.endsWith('.json'));
    const alive = (await Promise.all(files.map(readRegistryEntry)))
      .filter((entry) => entry?.pid && entry.sessionId && entry.cwd && isProcessAlive(entry.pid));
    const starts = await processStarts(alive.map((entry) => entry.pid));
    return alive.filter((entry) => startTimesMatch(entry.procStart, starts.get(entry.pid)));
  }

  /** Sessions whose process is still running, enriched from their transcripts. */
  async function liveSessions() {
    const entries = await runningEntries();
    const hosts = await detectHosts(entries.map((entry) => entry.pid));
    const sessions = await Promise.all(entries.map(async (entry) => ({
      pid: entry.pid,
      sessionId: entry.sessionId,
      name: entry.name ?? null,
      // "derived" names are generated from the folder; anything else is one you chose.
      nameIsCustom: Boolean(entry.nameSource) && entry.nameSource !== 'derived',
      cwd: entry.cwd,
      ...readStatus(entry.status),
      kind: entry.kind ?? null,
      startedAt: entry.startedAt ?? null,
      // When its process started, as Claude recorded it: End checks the pid is still this session's before signalling it.
      procStart: entry.procStart ?? null,
      statusUpdatedAt: entry.statusUpdatedAt ?? entry.updatedAt ?? null,
      // Which app (iTerm, VS Code…) or tmux session it runs in, so Jump and Reply know how to get there.
      host: hosts.get(entry.pid) ?? null,
      resumeCommand: resumeHere(entry.cwd, entry.sessionId),
      transcript: await summarize(transcriptPath(entry.cwd, entry.sessionId)),
    })));
    return Promise.all(sessions.map(async (session) => {
      const prompt = await readScreenPrompt(session, readScreen);
      return { ...session, screenPrompt: prompt && { ...prompt, plan: await readPlan(plansDir, prompt.planFile) } };
    }));
  }

  async function listTranscripts(dir) {
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
    return Promise.all(files.map(async (f) => {
      const info = await stat(join(dir, f));
      return { file: join(dir, f), sessionId: f.replace(/\.jsonl$/, ''), mtime: info.mtimeMs, size: info.size };
    }));
  }

  /** The most recently written transcript for a directory, live or not. */
  async function latestSession(cwd) {
    const transcripts = await listTranscripts(join(projectsDir, transcriptDirName(cwd)));
    if (transcripts.length === 0) return null;
    const newest = transcripts.reduce((a, b) => (b.mtime > a.mtime ? b : a));
    return {
      sessionId: newest.sessionId,
      updatedAt: newest.mtime,
      resumeCommand: resumeHere(cwd, newest.sessionId),
      transcript: await summarize(newest.file, newest.size),
    };
  }

  /** A folder's resumable sessions, newest first, leaving out `exclude` (e.g. running ones). */
  async function recentSessions(cwd, { limit = DEFAULT_RECENT_LIMIT, exclude = new Set() } = {}) {
    const candidates = (await listTranscripts(join(projectsDir, transcriptDirName(cwd))))
      .filter((t) => !exclude.has(t.sessionId))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit * RECENT_SCAN_FACTOR);
    const sessions = await mapLimit(candidates, SUMMARY_CONCURRENCY, async (t) => {
      const transcript = await summarize(t.file, t.size);
      if (!isResumable(transcript)) return null;
      return {
        sessionId: t.sessionId,
        updatedAt: transcript.lastActivityAt ?? t.mtime,
        endState: transcript.endState,
        resumeCommand: resumeHere(cwd, t.sessionId),
        transcript,
      };
    });
    // Files get touched after a session ends (e.g. titles written later), so order by real activity.
    return sessions.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  /** Sessions that are no longer running but were active since `since` (ms). */
  async function endedSessions({ since, liveSessionIds }) {
    const dirs = (await readdir(projectsDir, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory())
      .map((d) => join(projectsDir, d.name));
    const recent = (await Promise.all(dirs.map(listTranscripts))).flat()
      .filter((t) => t.mtime >= since && !liveSessionIds.has(t.sessionId));
    const sessions = await mapLimit(recent, SUMMARY_CONCURRENCY, async (t) => {
      const transcript = await summarize(t.file, t.size);
      if (!transcript?.cwd || !isResumable(transcript)) return null;
      return {
        sessionId: t.sessionId,
        cwd: transcript.cwd,
        endedAt: transcript.lastActivityAt ?? t.mtime,
        endState: transcript.endState,
        endError: transcript.endError ?? null,
        resumeCommand: resumeHere(transcript.cwd, t.sessionId),
        transcript,
      };
    });
    return sessions.filter(Boolean).sort((a, b) => b.endedAt - a.endedAt);
  }

  return {
    id: 'claude',
    label: 'Claude Code',
    // What a new task's pane is watched for: the program's own name.
    get command() {
      return basename(settings().program);
    },
    launchCommand,
    /** One session's summary (its last reply, activity…) by its folder and id, live or ended; null when it has no transcript. */
    readSession: async (cwd, sessionId) => (SESSION_UUID.test(sessionId) ? summarize(transcriptPath(cwd, sessionId)) : null),
    /** One session's last reply in full, by its folder and id; null when it has none (or no transcript yet). */
    readReply,
    // A lead or a worker (see hub-start.js) is started with a permission mode, settings or switchyard's MCP config.
    takesLaunchOptions: true,
    resumeCommand: resumeInPlace,
    liveSessions,
    latestSession,
    recentSessions,
    endedSessions,
  };
}
