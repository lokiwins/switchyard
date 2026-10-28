import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4477;
const DEFAULT_ROOT_CANDIDATES = ['~/work', '~/code', '~/src', '~/projects', '~/dev'];
const CONFIG_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

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

function resolveRoots(fileRoots) {
  const envRoots = process.env.SWITCHYARD_ROOTS?.split(':').filter(Boolean);
  const roots = envRoots ?? fileRoots ?? DEFAULT_ROOT_CANDIDATES;
  return roots.map(expandHome).filter((root) => existsSync(root));
}

export function loadConfig() {
  const file = readConfigFile();
  const roots = resolveRoots(file.roots);
  if (roots.length === 0) {
    throw new Error('No repository roots found. Set "roots" in config.json or SWITCHYARD_ROOTS.');
  }
  return {
    port: Number(process.env.PORT ?? file.port ?? DEFAULT_PORT),
    roots,
    claudeDir: expandHome(file.claudeDir ?? '~/.claude'),
  };
}
