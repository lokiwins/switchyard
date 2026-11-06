import { basename } from 'node:path';
import { windowNameFor } from './tmux.js';

/*
 * The one tmux session switchyard runs Claude in: each new task or resumed
 * session is a window (tab) in it, so Jump, Reply, Stop and the live terminal
 * all reach it through tmux.
 */

export const TASK_SESSION = 'switchyard';
// A window named after its folder gets -2, -3… when taken, up to this.
const MAX_NAME_TRIES = 50;

/** A free window name for `folder`: its name, then -2, -3… */
export async function freeWindowName(tmux, folder) {
  const base = windowNameFor(basename(folder));
  for (let n = 1; n <= MAX_NAME_TRIES; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!(await tmux.hasWindow(TASK_SESSION, name))) return name;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Open a background window named `name` in `cwd` and type `command` into its
 * shell. If typing fails, the window is closed again. Resolves to the window
 * as "switchyard:<name>", with its ids.
 */
export async function runInWindow(tmux, { name, cwd, command }) {
  const opened = await tmux.newWindow({ session: TASK_SESSION, name, cwd });
  try {
    await tmux.sendLine(opened.pane, command);
  } catch (error) {
    await tmux.killWindow(opened.window).catch(() => {});
    throw error;
  }
  return { place: `${TASK_SESSION}:${name}`, window: opened.window, pane: opened.pane };
}
