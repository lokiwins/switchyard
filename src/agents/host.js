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

/** Parse `ps -axo pid=,ppid=,comm=` into pid -> { ppid, command }. */
export function parseProcessTable(text) {
  return new Map(text.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/);
    return match ? [[Number(match[1]), { ppid: Number(match[2]), command: match[3] }]] : [];
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

/** pid -> host for each pid; an empty map if `ps` is unavailable. */
export async function detectHosts(pids) {
  if (pids.length === 0) return new Map();
  try {
    const table = parseProcessTable(await run('ps', ['-axo', 'pid=,ppid=,comm=']));
    return new Map(pids.map((pid) => [pid, findHost(pid, table)]));
  } catch {
    return new Map();
  }
}
