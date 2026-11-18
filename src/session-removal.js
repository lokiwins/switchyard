import { existsSync } from 'node:fs';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ActionError } from './errors.js';
import { createJsonFile, defaultStoreDir } from './json-store.js';

/*
 * Deleting ended sessions from the Agents page, two ways. Hiding takes one
 * off switchyard's lists and leaves Claude's transcript alone, so
 * `claude --resume` still finds it. Deleting the transcript moves it, and the
 * folder of subagent and tool output beside it, to the Trash. Either can be
 * undone for a while; only ended sessions are ever touched.
 */

const FILE = 'hidden-sessions.json';
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
// "Delete all ended" sends every listed session at once.
const MAX_IDS = 1000;
// How long a deleted transcript can be put back from here.
export const UNDO_MS = 10 * 60_000;
// Ended sessions are listed this long by default (Settings: agents.endedHistoryDays).
const DEFAULT_KEEP_MS = 7 * 24 * 60 * 60_000;

/** A hidden session stays hidden until it's resumed and ends again, later than when it was hidden. */
export function isHidden(session, hidden) {
  return hidden.has(session.sessionId) && hidden.get(session.sessionId) >= session.endedAt;
}

function parseId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new ActionError(400, 'Expected { sessionId: "<id>" }');
  return id;
}

function parseIds(body) {
  const ids = body?.sessionIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string' && SESSION_ID.test(id))) {
    throw new ActionError(400, `Expected { sessionIds: [1 to ${MAX_IDS} session ids] }`);
  }
  return [...new Set(ids)];
}

/** `name`, or "<base> 2<ext>", "<base> 3<ext>"… whichever isn't in `dir` yet, as the Finder names them. */
function freeName(dir, base, ext = '') {
  for (let n = 1; ; n += 1) {
    const path = join(dir, n === 1 ? `${base}${ext}` : `${base} ${n}${ext}`);
    if (!existsSync(path)) return path;
  }
}

/**
 * @param {object} deps
 * @param {{ read: () => Promise<object>, write: (data: object) => Promise<void> }} [deps.file] Where hidden sessions are kept.
 * @param {string} deps.claudeDir Claude's folder, holding projects/<folder>/<session>.jsonl.
 * @param {string} [deps.trashDir] Where deleted transcripts go: your Trash.
 * @param {() => Promise<{ endedSessions: object[] }>} deps.getState The sessions as listed now.
 * @param {() => void} [deps.onChange] Called after every change, so the pages update.
 * @param {() => number} [deps.keepForMs] How long ended sessions are listed: a hidden one older
 *   than that has left the lists anyway, so it's forgotten and the file never keeps growing.
 */
export function createSessionRemoval({
  file = createJsonFile(defaultStoreDir(), FILE),
  claudeDir,
  trashDir = join(homedir(), '.Trash'),
  getState,
  onChange = () => {},
  now = Date.now,
  keepForMs = () => DEFAULT_KEEP_MS,
}) {
  const projectsDir = join(claudeDir, 'projects');
  let loaded = null;
  // Changes run one at a time, each on what the one before it left.
  let queue = Promise.resolve();
  const trashed = new Map(); // sessionId -> { at, moves: [{ from, to }] }

  function hidden() {
    loaded ??= file.read().then((data) => new Map(Object.entries(data.sessions ?? {}).filter(([, at]) => Number.isFinite(at))));
    return loaded;
  }

  function serial(change) {
    const run = queue.then(change);
    queue = run.catch(() => {});
    return run;
  }

  async function save(map) {
    const cutoff = now() - keepForMs();
    const kept = [...map].filter(([, endedAt]) => endedAt >= cutoff);
    loaded = Promise.resolve(new Map(kept));
    await file.write({ sessions: Object.fromEntries(kept) });
  }

  async function endedById() {
    const state = await getState();
    return new Map((state.endedSessions ?? []).map((s) => [s.sessionId, s]));
  }

  async function hide(body) {
    const ids = parseIds(body);
    return serial(async () => {
      const ended = await endedById();
      const found = ids.filter((id) => ended.has(id));
      if (found.length === 0) throw new ActionError(404, 'Only ended sessions can be deleted, and that one isn\'t listed as ended');
      const next = new Map(await hidden());
      found.forEach((id) => next.set(id, ended.get(id).endedAt));
      await save(next);
      onChange();
      return { hidden: found };
    });
  }

  /** Take sessions off the lists without checking they're listed as ended: a task being put away, say, whose sessions it just ended. */
  function forget(sessions) {
    return serial(async () => {
      const next = new Map(await hidden());
      sessions.forEach(({ sessionId, endedAt }) => next.set(sessionId, endedAt));
      await save(next);
      onChange();
    });
  }

  async function unhide(body) {
    const ids = parseIds(body);
    return serial(async () => {
      const next = new Map(await hidden());
      const shown = ids.filter((id) => next.delete(id));
      await save(next);
      onChange();
      return { shown };
    });
  }

  /** The transcript's folder under projects/, found by looking: folder names don't map back to paths reliably. */
  async function transcriptFolder(sessionId) {
    const dirs = (await readdir(projectsDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
    const match = dirs.find((d) => existsSync(join(projectsDir, d.name, `${sessionId}.jsonl`)));
    return match ? join(projectsDir, match.name) : null;
  }

  async function trash(body) {
    const sessionId = parseId(body?.sessionId);
    return serial(async () => {
      if (!(await endedById()).has(sessionId)) throw new ActionError(404, 'Only an ended session\'s transcript can be deleted, and that one isn\'t listed as ended');
      const folder = await transcriptFolder(sessionId);
      if (!folder) throw new ActionError(404, 'That session\'s transcript is already gone');
      const moves = [{ from: join(folder, `${sessionId}.jsonl`), to: freeName(trashDir, sessionId, '.jsonl') }];
      const outputs = join(folder, sessionId);
      if (existsSync(outputs)) moves.push({ from: outputs, to: freeName(trashDir, sessionId) });
      await mkdir(trashDir, { recursive: true });
      const done = [];
      try {
        for (const move of moves) {
          await rename(move.from, move.to);
          done.push(move);
        }
      } catch (error) {
        // Put back whatever moved, so a session is never left half deleted.
        await Promise.all(done.map((move) => rename(move.to, move.from).catch(() => {})));
        throw new ActionError(500, `Could not move the transcript to the Trash: ${error.message}`);
      }
      trashed.set(sessionId, { at: now(), moves });
      onChange();
      return { trashed: sessionId };
    });
  }

  async function restore(body) {
    const sessionId = parseId(body?.sessionId);
    return serial(async () => {
      const entry = trashed.get(sessionId);
      if (!entry || now() - entry.at > UNDO_MS) {
        trashed.delete(sessionId);
        throw new ActionError(410, 'Too late to undo here; the transcript is in your Trash');
      }
      if (entry.moves.some((move) => existsSync(move.from))) throw new ActionError(409, 'A transcript with that id is back in its folder; the deleted one stays in your Trash');
      if (entry.moves.some((move) => !existsSync(move.to))) throw new ActionError(410, 'The deleted transcript is no longer in your Trash');
      for (const move of entry.moves) await rename(move.to, move.from);
      trashed.delete(sessionId);
      onChange();
      return { restored: sessionId };
    });
  }

  return { hidden, hide, forget, unhide, trash, restore };
}
