import { resolveRoots } from './config.js';
import { parseSettings } from './settings.js';

/*
 * The config every service holds, kept current when the Settings page saves:
 * services read `config.roots` and `config.settings.<section>` when they use
 * them, so a saved change applies without a restart. Port and claudeDir are
 * fixed once switchyard has started.
 */
export function createLiveConfig(config, { env = process.env } = {}) {
  let roots = config.roots;
  let current = config.settings;
  const listeners = [];
  const settings = Object.fromEntries(Object.keys(current).map((name) => [name, null]));
  for (const name of Object.keys(settings)) Object.defineProperty(settings, name, { get: () => current[name], enumerable: true });

  return {
    port: config.port,
    claudeDir: config.claudeDir,
    settings,
    get roots() {
      return roots;
    },
    /** Whether SWITCHYARD_ROOTS sets the roots, so a saved list waits until it's unset. */
    rootsFromEnv: Boolean(env.SWITCHYARD_ROOTS),

    /** Take on a saved config.json. */
    update(file) {
      current = parseSettings(file);
      const next = resolveRoots(file.roots, env);
      if (next.length > 0) roots = next;
      for (const listener of listeners) listener({ settings: current, roots });
    },

    onChange(listener) {
      listeners.push(listener);
    },
  };
}
