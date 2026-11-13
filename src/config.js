import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSettings } from './settings.js';

const DEFAULT_PORT = 4477;
const DEFAULT_ROOT_CANDIDATES = ['~/work', '~/code', '~/src', '~/projects', '~/dev'];
// SWITCHYARD_CONFIG points elsewhere, e.g. at the screenshots' own config.json.
export const CONFIG_FILE = process.env.SWITCHYARD_CONFIG ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

export function expandHome(path) {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

function readConfigFile() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${CONFIG_FILE}: ${error.message}`);
  }
}

/** The folders to look for repos in: SWITCHYARD_ROOTS, else config.json's roots, else the usual places; only ones that exist. */
export function resolveRoots(fileRoots, env = process.env) {
  const envRoots = env.SWITCHYARD_ROOTS?.split(':').filter(Boolean);
  const roots = envRoots ?? fileRoots ?? DEFAULT_ROOT_CANDIDATES;
  return roots.map(expandHome).filter((root) => existsSync(root));
}

export function loadConfig() {
  const file = readConfigFile();
  const settings = parseSettings(file);
  const roots = resolveRoots(file.roots);
  if (roots.length === 0) {
    throw new Error('No repository roots found. Set "roots" in config.json or SWITCHYARD_ROOTS.');
  }
  return {
    port: Number(process.env.PORT ?? file.port ?? DEFAULT_PORT),
    roots,
    claudeDir: expandHome(file.claudeDir ?? '~/.claude'),
    settings,
  };
}
