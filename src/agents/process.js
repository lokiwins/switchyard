import { run } from '../exec.js';

const START_TOLERANCE_MS = 2000;

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
