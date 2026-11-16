import { run } from '../exec.js';

const START_TOLERANCE_MS = 2000;
// A running process's start time doesn't change; each is looked up again this often anyway,
// so a pid that ended and was reused by another process is caught.
const START_RECHECK_MS = 60_000;

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Parse `ps -o pid=,lstart=` output into pid -> start time (ms). lstart is local time. */
export function parseProcessStarts(text) {
  return new Map(text.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    const startedAt = match ? Date.parse(match[2]) : NaN;
    return Number.isFinite(startedAt) ? [[Number(match[1]), startedAt]] : [];
  }));
}

/**
 * Whether a recorded process start (e.g. "Wed Oct 28 17:10:45 2026", written
 * in UTC by Claude Code) matches the start time of the running process. Both
 * UTC and local readings are accepted so a format change can't hide sessions.
 */
export function startTimesMatch(recorded, actualMs) {
  if (!recorded || !Number.isFinite(actualMs)) return true;
  const readings = [Date.parse(`${recorded} GMT`), Date.parse(recorded)].filter(Number.isFinite);
  if (readings.length === 0) return true;
  return readings.some((ms) => Math.abs(ms - actualMs) <= START_TOLERANCE_MS);
}

/** Start times for the given pids; an empty map if `ps` is unavailable. */
export async function getProcessStarts(pids) {
  if (pids.length === 0) return new Map();
  try {
    return parseProcessStarts(await run('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')]));
  } catch {
    // ps exits non-zero when some pids are gone; liveness is checked separately.
    return new Map();
  }
}

/**
 * getProcessStarts, remembered: ps is asked only about pids not seen before,
 * or last looked up more than `ttlMs` ago. Pids not asked about are forgotten
 * (they ended, and the system may reuse them); so is any ps has no start for.
 */
export function createProcessStarts({ list = getProcessStarts, now = Date.now, ttlMs = START_RECHECK_MS } = {}) {
  let known = new Map(); // pid -> { startedAt, checkedAt }
  return async function processStarts(pids) {
    const time = now();
    const stale = pids.filter((pid) => !known.has(pid) || time - known.get(pid).checkedAt >= ttlMs);
    const fresh = stale.length > 0 ? await list(stale) : new Map();
    known = new Map(pids.flatMap((pid) => {
      if (fresh.has(pid)) return [[pid, { startedAt: fresh.get(pid), checkedAt: time }]];
      if (!stale.includes(pid) && known.has(pid)) return [[pid, known.get(pid)]];
      return [];
    }));
    return new Map([...known].map(([pid, { startedAt }]) => [pid, startedAt]));
  };
}
