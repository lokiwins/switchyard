import { watch } from 'node:fs';

/*
 * Pushes the Agents page's data to open pages as sessions change, instead of
 * waiting for the page's next poll. Claude Code rewrites its session registry
 * (~/.claude/sessions/<pid>.json) the moment a session starts, ends or changes
 * status, and not otherwise, so watching that one folder is both prompt and
 * quiet. The page keeps a slow poll in case a change is missed.
 */

// Changes within this long of the first one go out as one update (e.g. several sessions at once).
const GATHER_MS = 50;

/**
 * Call `onChange` when anything in `dir` changes, at most once per `gatherMs`.
 * Returns a function that stops watching. A folder that can't be watched is
 * reported to `onError` and left to the poll.
 */
export function watchFolder(dir, onChange, { watchDir = watch, gatherMs = GATHER_MS, onError = () => {} } = {}) {
  let timer = null;
  const changed = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, gatherMs);
  };
  let watcher;
  try {
    watcher = watchDir(dir, changed);
    watcher.on('error', onError);
  } catch (error) {
    onError(error);
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/**
 * Subscribers get `load()`'s data after each `changed()`. Loads run one at a time; a change during a load starts another
 * when it finishes, so the last update always reflects the last change.
 * Nothing loads while no one is subscribed.
 */
export function createAgentFeed({ load, onError = () => {} }) {
  const subscribers = new Set();
  let loading = false;
  let again = false;

  async function publish() {
    if (loading) {
      again = true;
      return;
    }
    loading = true;
    try {
      do {
        again = false;
        if (subscribers.size === 0) break;
        try {
          const data = await load();
          subscribers.forEach((send) => send(data));
        } catch (error) {
          onError(error);
        }
      } while (again);
    } finally {
      loading = false;
    }
  }

  /** Call `send` with fresh data after every change, until the returned function is called. */
  function subscribe(send) {
    subscribers.add(send);
    return () => subscribers.delete(send);
  }

  return { changed: () => { publish(); }, subscribe };
}
