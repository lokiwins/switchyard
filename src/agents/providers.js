import { ActionError } from '../errors.js';

/*
 * The agent CLIs switchyard runs and watches. Claude Code is the only one
 * today; another (Codex, say) is one more provider with the same shape:
 *
 *   id, label           'claude', 'Claude Code'
 *   command             the program typed in a terminal, watched for when a task starts
 *   launchCommand(p?)   the command line that starts it, on task p when given
 *   resumeCommand(id)   the command line that resumes one of its sessions
 *   liveSessions()                     its running sessions
 *   latestSession(cwd)                 a folder's newest session, or null
 *   recentSessions(cwd, {limit, exclude})  a folder's resumable sessions, newest first
 *   endedSessions({since, liveSessionIds}) sessions ended since `since`
 *
 * The registry lists sessions from every provider together, each one saying
 * which provider it came from, so actions on it go back to that provider.
 */

const ID = /^[a-z][a-z0-9-]{0,31}$/;
// A bare program name: it's typed into a shell, and matched on screen.
const COMMAND = /^[A-Za-z0-9._-]+$/;
const METHODS = ['launchCommand', 'resumeCommand', 'liveSessions', 'latestSession', 'recentSessions', 'endedSessions'];

function checkProvider(provider) {
  if (!ID.test(provider?.id ?? '')) throw new Error(`An agent provider needs an id of lowercase letters, digits and "-" (got ${JSON.stringify(provider?.id)})`);
  if (typeof provider.label !== 'string' || provider.label === '') throw new Error(`Agent provider ${provider.id} needs a label`);
  if (!COMMAND.test(provider.command ?? '')) throw new Error(`Agent provider ${provider.id} needs a command that is a bare program name`);
  const missing = METHODS.filter((name) => typeof provider[name] !== 'function');
  if (missing.length > 0) throw new Error(`Agent provider ${provider.id} is missing ${missing.join(', ')}`);
}

const newestFirst = (key) => (a, b) => (b[key] ?? 0) - (a[key] ?? 0);

/**
 * @param {object[]} providers In the order they're offered; the first is the default unless `defaultId` names another.
 * @param {{ defaultId?: string }} [options]
 */
export function createAgentProviders(providers, { defaultId } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) throw new Error('At least one agent provider is needed');
  providers.forEach(checkProvider);
  const byId = new Map();
  for (const provider of providers) {
    if (byId.has(provider.id)) throw new Error(`Two agent providers are called ${provider.id}`);
    byId.set(provider.id, provider);
  }
  const fallback = defaultId === undefined ? providers[0] : byId.get(defaultId);
  if (!fallback) throw new Error(`The default agent provider ${defaultId} is not one of ${[...byId.keys()].join(', ')}`);

  /** The provider called `id`; a 400 for any other, as ids come from requests. */
  function get(id) {
    const provider = byId.get(id);
    if (!provider) throw new ActionError(400, `Unknown agent ${JSON.stringify(id)}; expected one of ${[...byId.keys()].join(', ')}`);
    return provider;
  }

  /** The provider a session came from (sessions listed before providers had names are the default's). */
  const forSession = (session) => (session?.provider === undefined ? fallback : get(session.provider));

  const tagged = (provider) => (session) => ({ ...session, provider: provider.id });
  /** Each provider's answer, its sessions tagged with where they came from. */
  const fromEach = (ask) => Promise.all(providers.map(async (p) => (await ask(p)).map(tagged(p))));

  return {
    list: providers.map(({ id, label }) => ({ id, label })),
    default: fallback,
    get,
    forSession,
    liveSessions: async () => (await fromEach((p) => p.liveSessions())).flat(),
    async latestSession(cwd) {
      const latest = (await fromEach(async (p) => [await p.latestSession(cwd)].filter(Boolean))).flat();
      return latest.sort(newestFirst('updatedAt'))[0] ?? null;
    },
    async recentSessions(cwd, options = {}) {
      const recent = (await fromEach((p) => p.recentSessions(cwd, options))).flat().sort(newestFirst('updatedAt'));
      return options.limit === undefined ? recent : recent.slice(0, options.limit);
    },
    endedSessions: async (options) => (await fromEach((p) => p.endedSessions(options))).flat().sort(newestFirst('endedAt')),
  };
}
