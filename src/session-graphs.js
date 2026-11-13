import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGraphBuilder } from './agents/session-graph.js';
import { ActionError } from './errors.js';

/*
 * Session graphs for the graph page (see agents/session-graph.js). A session's
 * transcript and its subagents' transcripts are append-only, so each is read
 * from where the last read stopped; a page open on a running session gets a
 * fresh graph whenever they grow. One reader per session, shared by every page
 * open on it, and stopped when the last one leaves.
 */

const POLL_MS = 1000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBAGENT_FILE = /^agent-(.+)\.jsonl$/;

function parseLine(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Reads a growing JSONL file from where it left off, holding back a last line still being written. */
function createTail(file) {
  let offset = 0;
  let carry = '';
  return async function readNew() {
    let handle;
    try {
      handle = await open(file, 'r');
    } catch {
      return [];
    }
    try {
      const { size } = await handle.stat();
      if (size <= offset) return [];
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - offset), 0, size - offset, offset);
      offset += bytesRead;
      // Split on bytes, so a character split across reads is joined before decoding.
      const text = carry + buffer.subarray(0, bytesRead).toString('latin1');
      const lines = text.split('\n');
      carry = lines.pop();
      return lines.filter(Boolean).map((l) => parseLine(Buffer.from(l, 'latin1').toString('utf8'))).filter(Boolean);
    } finally {
      await handle.close();
    }
  };
}

async function readMeta(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{ claudeDir: string, home: string, pollMs?: number }} options
 */
export function createSessionGraphs({ claudeDir, home, pollMs = POLL_MS }) {
  const projectsDir = join(claudeDir, 'projects');
  const readers = new Map();

  async function findTranscript(sessionId) {
    if (!SESSION_ID.test(sessionId ?? '')) throw new ActionError(400, 'Not a session id');
    const dirs = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const dir of dirs.filter((d) => d.isDirectory())) {
      const names = await readdir(join(projectsDir, dir.name)).catch(() => []);
      if (names.includes(`${sessionId}.jsonl`)) return { dir: join(projectsDir, dir.name), file: join(projectsDir, dir.name, `${sessionId}.jsonl`) };
    }
    throw new ActionError(404, 'No transcript for that session');
  }

  /** A session's graph, kept up to date by `refresh()`; `refresh` says whether anything changed. */
  async function createReader(sessionId) {
    const { dir, file } = await findTranscript(sessionId);
    const builder = createGraphBuilder({ cwd: null, home, claudeDir });
    const readMain = createTail(file);
    const subagentsDir = join(dir, sessionId, 'subagents');
    const subagents = new Map();

    async function refreshSubagents() {
      const names = await readdir(subagentsDir).catch(() => []);
      let changed = false;
      for (const name of names) {
        const match = name.match(SUBAGENT_FILE);
        if (!match) continue;
        if (!subagents.has(name)) {
          const meta = await readMeta(join(subagentsDir, `agent-${match[1]}.meta.json`));
          const key = meta?.toolUseId ?? match[1];
          builder.addSubagentMeta(key, meta);
          subagents.set(name, { key, readNew: createTail(join(subagentsDir, name)) });
          changed = true;
        }
        const { key, readNew } = subagents.get(name);
        const entries = await readNew();
        for (const entry of entries) builder.add(entry, { subagent: key });
        changed ||= entries.length > 0;
      }
      return changed;
    }

    async function refresh() {
      const entries = await readMain();
      for (const entry of entries) builder.add(entry);
      const subagentsChanged = await refreshSubagents();
      return entries.length > 0 || subagentsChanged;
    }

    await refresh();
    return { refresh, graph: () => ({ sessionId, ...builder.snapshot() }) };
  }

  /** The graph as it stands. */
  async function snapshot(sessionId) {
    const watched = readers.get(sessionId);
    if (watched) return (await watched.ready).graph();
    return (await createReader(sessionId)).graph();
  }

  function startWatching(sessionId) {
    const watched = { subscribers: new Set(), timer: null, ready: createReader(sessionId) };
    readers.set(sessionId, watched);
    watched.ready.catch(() => readers.delete(sessionId));
    let busy = false;
    watched.timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const reader = await watched.ready;
        if (await reader.refresh()) {
          const graph = reader.graph();
          for (const send of watched.subscribers) send(graph);
        }
      } catch {
        // A transcript that can't be read now is tried again on the next tick.
      } finally {
        busy = false;
      }
    }, pollMs);
    return watched;
  }

  /**
   * Call `send(graph)` now and whenever the session's transcripts grow.
   * Returns a function that stops; rejects (400/404) for an unknown session.
   */
  async function subscribe(sessionId, send) {
    const watched = readers.get(sessionId) ?? startWatching(sessionId);
    let reader;
    try {
      reader = await watched.ready;
    } catch (error) {
      clearInterval(watched.timer);
      throw error;
    }
    watched.subscribers.add(send);
    send(reader.graph());
    return () => {
      watched.subscribers.delete(send);
      if (watched.subscribers.size > 0) return;
      clearInterval(watched.timer);
      readers.delete(sessionId);
    };
  }

  /** How many sessions are being watched (for tests). */
  const watching = () => readers.size;

  return { snapshot, subscribe, watching };
}
