import { chmod, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';

/*
 * The Claude Code hook that sends permission prompts to switchyard. It lives
 * in Claude Code's user settings, so it applies to every session. When
 * switchyard isn't running the hook can't connect, and Claude Code shows its
 * usual prompt as if the hook weren't there.
 */

export const HOOK_PATH = '/hooks/permission-request';
// Claude Code shows its own prompt while the hook waits, so a long wait never blocks you;
// it only bounds how long a prompt stays answerable from the page.
// Keep in step with MAX_AGE_MS in approvals.js.
const HOOK_TIMEOUT_SECONDS = 3600;
const EVENT = 'PermissionRequest';

// 127.0.0.1, not localhost: the server listens on IPv4 only, and localhost may resolve to ::1.
export const hookUrl = (port) => `http://127.0.0.1:${port}${HOOK_PATH}`;

const isOurs = (port) => (hook) => hook?.type === 'http' && hook.url === hookUrl(port);

export function isHookInstalled(settings, port) {
  return (settings.hooks?.[EVENT] ?? []).some((matcher) => (matcher.hooks ?? []).some(isOurs(port)));
}

/** Settings with switchyard's hook added (unchanged if it's already there). */
export function withHook(settings, port) {
  if (isHookInstalled(settings, port)) return settings;
  const entry = { hooks: [{ type: 'http', url: hookUrl(port), timeout: HOOK_TIMEOUT_SECONDS }] };
  const hooks = settings.hooks ?? {};
  return { ...settings, hooks: { ...hooks, [EVENT]: [...(hooks[EVENT] ?? []), entry] } };
}

/** Settings with switchyard's hook taken out, and any matcher left empty by that. */
export function withoutHook(settings, port) {
  if (!isHookInstalled(settings, port)) return settings;
  const hooks = settings.hooks ?? {};
  const matchers = (hooks[EVENT] ?? [])
    .map((matcher) => ({ ...matcher, hooks: (matcher.hooks ?? []).filter((hook) => !isOurs(port)(hook)) }))
    .filter((matcher) => matcher.hooks.length > 0);
  const { [EVENT]: _removed, ...others } = hooks;
  return { ...settings, hooks: matchers.length > 0 ? { ...others, [EVENT]: matchers } : others };
}

export async function readClaudeSettings(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON, so switchyard won't change it`);
  }
}

/**
 * Write via a temporary file, so Claude Code never reads a half-written
 * settings file. A symlinked settings file is written through, and the
 * file keeps its permissions.
 */
export async function writeClaudeSettings(file, settings) {
  const target = await realpath(file).catch(() => file);
  const mode = await stat(target).then((info) => info.mode & 0o777, () => 0o600);
  const temp = `${target}.switchyard-${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  await chmod(temp, mode);
  await rename(temp, target);
}
