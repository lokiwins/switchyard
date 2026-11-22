import { join } from 'node:path';
import { ActionError } from './errors.js';
import { createJsonFile, writePrivateFile } from './json-store.js';

/*
 * How each session's last turn went, as Claude Code tells it through hooks,
 * rather than guessed afterwards from the end of its transcript. Only the
 * sessions switchyard starts carry these hooks (in the settings file each is
 * started with). A prompt starts a turn, Stop ends it, StopFailure ends it on
 * an API error (rate limit, overloaded…), and SessionEnd says the session is
 * over. A turn that never stopped was cut off. The hooks only reach switchyard
 * while it runs; a session with no events keeps the transcript's reading.
 */

export const EVENTS_PATH = '/hooks/session-event';
// SessionEnd hooks get 1.5 s by default; a local POST needs far less, and Claude carries on either way.
const HOOK_TIMEOUT_SECONDS = 2;
const FILE = 'session-events.json';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ERROR_LENGTH = 64;
const MAX_REASON_LENGTH = 32;
const DEFAULT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** What each event does to a session's record. */
const EVENTS = {
  UserPromptSubmit: () => ({ turn: 'running' }),
  Stop: (record) => ({ ...record, turn: 'finished' }),
  StopFailure: (record, input) => ({ ...record, turn: 'failed', error: short(input.error, MAX_ERROR_LENGTH) ?? 'unknown' }),
  SessionEnd: (record, input) => ({ ...record, ended: short(input.reason, MAX_REASON_LENGTH) ?? 'other' }),
};

const short = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);

// 127.0.0.1, not localhost: the server listens on IPv4 only, and localhost may resolve to ::1.
const eventsUrl = (port) => `http://127.0.0.1:${port}${EVENTS_PATH}`;

/** The hooks that send each event to this switchyard. */
export function eventHooks(port) {
  const matcher = { hooks: [{ type: 'http', url: eventsUrl(port), timeout: HOOK_TIMEOUT_SECONDS }] };
  return Object.fromEntries(Object.keys(EVENTS).map((event) => [event, [matcher]]));
}

/** `settings` (a session's own, e.g. its permissions) with the event hooks added beside any it has. */
export function withEventHooks(settings, port) {
  const own = settings.hooks ?? {};
  const hooks = Object.entries(eventHooks(port))
    .reduce((all, [event, matchers]) => ({ ...all, [event]: [...(own[event] ?? []), ...matchers] }), own);
  return { ...settings, hooks };
}

/**
 * The settings every session switchyard starts is given: `withHooks(settings)` for one that has its own (a
 * lead's, a worker's, a reviewer's), and `file()`, a settings file with only the hooks, for the rest.
 * @param {{ dir: string, port: number }} deps
 */
export function createSessionSettings({ dir, port }) {
  const path = join(dir, 'session.settings.json');
  let written = null;
  return {
    withHooks: (settings) => withEventHooks(settings, port),
    /** Written once, the first time a session needs it; tried again if that failed. */
    file() {
      written ??= writePrivateFile(dir, path, `${JSON.stringify({ hooks: eventHooks(port) }, null, 2)}\n`).then(() => path, (error) => {
        written = null;
        throw error;
      });
      return written;
    },
  };
}

/**
 * How a session ended, from its recorded last turn and the transcript's reading (`fromTranscript`, see
 * claude-transcript.js), which alone can tell an Esc or an /exit apart: hooks don't report those.
 */
export function endStateFrom(record, fromTranscript) {
  if (!record?.turn) return fromTranscript;
  if (record.turn === 'failed') return 'failed';
  if (record.turn === 'finished') return fromTranscript === 'exited' ? 'exited' : 'finished';
  return fromTranscript === 'stopped' || fromTranscript === 'exited' ? fromTranscript : 'interrupted';
}

/**
 * @param {{ dir: string, now?: () => number, keepForMs?: () => number, onChange?: () => void }} deps
 *   `dir` is switchyard's own folder (see json-store.js); records older than `keepForMs` are dropped.
 */
export function createSessionEvents({ dir, now = Date.now, keepForMs = () => DEFAULT_KEEP_MS, onChange = () => {} }) {
  const file = createJsonFile(dir, FILE);
  let records = {};
  // Writes one after another, so a slow one never lands after a newer one.
  let writing = Promise.resolve();

  const fresh = (all) => {
    const since = now() - keepForMs();
    return Object.fromEntries(Object.entries(all).filter(([, record]) => record?.at >= since));
  };

  return {
    /** Read the records saved before a restart. */
    async load() {
      records = fresh({ ...(await file.read()), ...records });
    },

    /** One hook's input: kept when it's an event tracked here, for a real session id. */
    async record(input) {
      const id = input?.session_id;
      if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new ActionError(400, 'Expected a hook with a session_id');
      const apply = Object.hasOwn(EVENTS, input.hook_event_name) ? EVENTS[input.hook_event_name] : null;
      if (!apply) return;
      records = fresh({ ...records, [id]: { ...apply(records[id] ?? {}, input), at: now() } });
      const snapshot = records;
      writing = writing.then(() => file.write(snapshot), () => file.write(snapshot));
      await writing;
      onChange();
    },

    /** A session's record: { turn: 'running'|'finished'|'failed', error?, ended?, at }, or null. */
    get: (id) => records[id] ?? null,
  };
}
