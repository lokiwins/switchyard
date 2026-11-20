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
 * @param {{ dir: string }} deps switchyard's own folder (see json-store.js).
 */
export function createWorkerLaunch({ dir }) {
  return {
    /**
     * What worker `id` starts with, from `workers` (the Workers settings): { permissionMode?, settings? },
     * with the settings file written first. Empty when the settings ask for nothing.
     */
    async prepare(id, { permissionMode, allowedTools }) {
      if (!TASK_ID.pattern.test(id)) throw new Error('A worker\'s settings are for a task id');
      const launch = {};
      if (permissionMode !== CLAUDE_DEFAULT) launch.permissionMode = permissionMode;
      if (allowedTools.length > 0) {
        const folder = join(dir, WORKERS_DIR);
        launch.settings = join(folder, `${id}.settings.json`);
        await writePrivateFile(folder, launch.settings, `${JSON.stringify({ permissions: { allow: allowedTools } }, null, 2)}\n`);
      }
      return launch;
    },
  };
}
