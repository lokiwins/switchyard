import { run } from '../exec.js';

const MAX_ANCESTRY = 25;

/**
 * Apps an agent session can live in, keyed by macOS bundle name.
 * - terminal: switchyard can select the exact tab by its tty
 * - editor: switchyard can bring the window for the folder forward via its URL scheme
 * Anything else is reported by name and brought to the front as a whole.
 */
const KNOWN_HOSTS = {
  iTerm: { kind: 'terminal', label: 'iTerm', app: 'iTerm' },
  Terminal: { kind: 'terminal', label: 'Terminal', app: 'Terminal' },
  'Visual Studio Code': { kind: 'editor', label: 'VS Code', scheme: 'vscode' },
  'Visual Studio Code - Insiders': { kind: 'editor', label: 'VS Code Insiders', scheme: 'vscode-insiders' },
  Cursor: { kind: 'editor', label: 'Cursor', scheme: 'cursor' },
  Windsurf: { kind: 'editor', label: 'Windsurf', scheme: 'windsurf' },
};

/** Parse `ps -axo pid=,ppid=,tty=,comm=` into pid -> { ppid, tty, command }; tty is null for "??". */
export function parseProcessTable(text) {
  return new Map(text.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/);
    if (!match) return [];
    const tty = match[3] === '??' ? null : `/dev/${match[3]}`;
    return [[Number(match[1]), { ppid: Number(match[2]), tty, command: match[4] }]];
  }));
}

/** The outermost .app bundle in an executable path, e.g. "Visual Studio Code" for its helper processes. */
export function appNameFromPath(command) {
  return command.match(/\/([^/]+)\.app\//)?.[1] ?? null;
}

export function describeHost(appName) {
  if (!appName) return null;
  return { ...(KNOWN_HOSTS[appName] ?? { kind: 'app', label: appName }), appName };
}

/** Walk up from `pid` to the first ancestor that runs from an app bundle. */
export function findHost(pid, table) {
  let current = table.get(pid)?.ppid;
  for (let i = 0; i < MAX_ANCESTRY && current && current !== 1; i++) {
    const entry = table.get(current);
    if (!entry) return null;
    const appName = appNameFromPath(entry.command);
    if (appName) return describeHost(appName);
    current = entry.ppid;
  }
  return null;
}

/** What can't change while a process runs: its tty, and the app it was started from. */
const processFacts = (pid, table) => ({ tty: table.get(pid)?.tty ?? null, app: findHost(pid, table) });

/**
 * A tmux server runs detached from any app, so a session inside tmux is known
 * by its tty instead: the tty of the tmux pane it runs in. A terminal app's
 * tab is found by its tty too, so that's kept with it.
 */
function hostFor({ tty, app }, tmuxPanes) {
  const pane = tmuxPanes.get(tty);
  if (pane) return { kind: 'tmux', label: 'tmux', ...pane };
  return app?.kind === 'terminal' && tty ? { ...app, tty } : app;
}

/** pid -> host, from a process table and the tmux panes by tty. */
export function hostsFor(pids, table, tmuxPanes) {
  return new Map(pids.map((pid) => [pid, hostFor(processFacts(pid, table), tmuxPanes)]));
}

const listProcesses = () => run('ps', ['-axo', 'pid=,ppid=,tty=,comm=']).then(parseProcessTable);

/**
 * pid -> host for each pid; an empty map if `ps` is unavailable. Listing every
 * process is the slow part, so each one's tty and app are remembered while
 * it keeps being asked about, and only new pids need a fresh list. tmux panes
 * are listed every time, since windows come and go.
 */
export function createHostDetector({ listTmuxPanes = async () => new Map(), processes = listProcesses } = {}) {
  let known = new Map();
  return async function detectHosts(pids) {
    if (pids.length === 0) return new Map();
    try {
      const missing = pids.filter((pid) => !known.has(pid));
      const [table, panes] = await Promise.all([missing.length > 0 ? processes() : null, listTmuxPanes()]);
      // Pids no longer running are forgotten, since the system reuses them.
      known = new Map(pids.flatMap((pid) => {
        if (known.has(pid)) return [[pid, known.get(pid)]];
        return table.has(pid) ? [[pid, processFacts(pid, table)]] : [];
      }));
      return new Map(pids.map((pid) => [pid, known.has(pid) ? hostFor(known.get(pid), panes) : null]));
    } catch {
      return new Map();
    }
  };
}
