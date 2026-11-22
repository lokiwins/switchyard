import { join } from 'node:path';
import { writePrivateFile } from './json-store.js';
import { TASK_ID } from './task-hub.js';

/*
 * How a lead's worker starts, from Settings › Workers: in the permission mode
 * chosen there, and allowed the tools listed there without asking. The rules
 * go in a settings file readable by you alone, given to Claude by its path,
 * so none of them is ever typed into a shell. Prompts for anything else still
 * come to you on the dashboard.
 */

const WORKERS_DIR = 'workers';
// Settings › Workers' "Your Claude default": no mode given, so Claude starts as your own settings say.
const CLAUDE_DEFAULT = 'claude';

/**
 * @param {{ dir: string, withHooks?: (settings: object) => object }} deps `dir` is switchyard's own folder (see
 *   json-store.js); `withHooks` adds the session event hooks (see session-events.js), so every worker gets a file.
 */
export function createWorkerLaunch({ dir, withHooks = null }) {
  return {
    /**
     * What worker `id` starts with, from `workers` (the Workers settings): { permissionMode?, settings? },
     * with the settings file written first. Empty when the settings ask for nothing.
     */
    async prepare(id, { permissionMode, allowedTools }) {
      if (!TASK_ID.pattern.test(id)) throw new Error('A worker\'s settings are for a task id');
      const launch = {};
      if (permissionMode !== CLAUDE_DEFAULT) launch.permissionMode = permissionMode;
      const own = allowedTools.length > 0 ? { permissions: { allow: allowedTools } } : null;
      const settings = withHooks ? withHooks(own ?? {}) : own;
      if (settings) {
        const folder = join(dir, WORKERS_DIR);
        launch.settings = join(folder, `${id}.settings.json`);
        await writePrivateFile(folder, launch.settings, `${JSON.stringify(settings, null, 2)}\n`);
      }
      return launch;
    },
  };
}
