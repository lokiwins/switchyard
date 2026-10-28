import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mapLimit } from '../exec.js';
import { summarizeFile, transcriptDirName } from './claude-transcript.js';
import { getProcessStarts, isProcessAlive, startTimesMatch } from './process.js';

export { summarizeTranscript, transcriptDirName } from './claude-transcript.js';

const SUMMARY_CONCURRENCY = 8;

/** `claude --resume` only finds sessions recorded for the current directory. */
export function resumeCommand(cwd, sessionId) {
  const quoted = /^[\w@%+=:,./-]+$/.test(cwd) ? cwd : `'${cwd.replace(/'/g, `'\\''`)}'`;
  return `cd ${quoted} && claude --resume ${sessionId}`;
}

export function createClaudeProvider({ claudeDir }) {
  const sessionsDir = join(claudeDir, 'sessions');
  const projectsDir = join(claudeDir, 'projects');

  const transcriptPath = (cwd, sessionId) => join(projectsDir, transcriptDirName(cwd), `${sessionId}.jsonl`);

  // Transcripts are append-only, so size identifies a summary's freshness.
  const summaries = new Map();

  async function summarize(file, knownSize) {
    try {
      const size = knownSize ?? (await stat(file)).size;
      const cached = summaries.get(file);
      if (cached?.size === size) return cached.summary;
      const summary = await summarizeFile(file);
      summaries.set(file, { size, summary });
      return summary;
    } catch {
      return null;
    }
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
    const starts = await getProcessStarts(alive.map((entry) => entry.pid));
    return alive.filter((entry) => startTimesMatch(entry.procStart, starts.get(entry.pid)));
  }

  /** Sessions whose process is still running, enriched from their transcripts. */
  async function liveSessions() {
    const entries = await runningEntries();
    return Promise.all(entries.map(async (entry) => ({
      agent: 'claude-code',
      pid: entry.pid,
      sessionId: entry.sessionId,
      name: entry.name ?? null,
      cwd: entry.cwd,
      status: entry.status ?? 'unknown',
      kind: entry.kind ?? null,
      startedAt: entry.startedAt ?? null,
      statusUpdatedAt: entry.statusUpdatedAt ?? entry.updatedAt ?? null,
      resumeCommand: resumeCommand(entry.cwd, entry.sessionId),
      transcript: await summarize(transcriptPath(entry.cwd, entry.sessionId)),
    })));
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
      agent: 'claude-code',
      sessionId: newest.sessionId,
      updatedAt: newest.mtime,
      resumeCommand: resumeCommand(cwd, newest.sessionId),
      transcript: await summarize(newest.file, newest.size),
    };
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
      if (!transcript?.cwd) return null;
      // A session that never got a prompt (opened, then /exit) has nothing to resume.
      if (!transcript.lastPrompt && transcript.endState !== 'interrupted') return null;
      return {
        agent: 'claude-code',
        sessionId: t.sessionId,
        cwd: transcript.cwd,
        endedAt: transcript.lastActivityAt ?? t.mtime,
        endState: transcript.endState,
        resumeCommand: resumeCommand(transcript.cwd, t.sessionId),
        transcript,
      };
    });
    return sessions.filter(Boolean).sort((a, b) => b.endedAt - a.endedAt);
  }

  return { liveSessions, latestSession, endedSessions };
}
