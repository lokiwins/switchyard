import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * switchyard's own files, outside the checkout: the task tools' token and
 * your tasks. The folder and files are readable by you alone.
 */

/** $XDG_CONFIG_HOME/switchyard, or ~/.config/switchyard. */
export function defaultStoreDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'switchyard');
}

/** Write `text` to `file` in `dir`, readable by you alone: the folder made (and kept) 0700, the file written whole, then moved into place, so a crash never leaves half a file. */
export async function writePrivateFile(dir, file, text) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
}

/** One JSON file in `dir`: read as an object ({} when missing or damaged), written whole. */
export function createJsonFile(dir, name) {
  const file = join(dir, name);
  return {
    async read() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    write: (data) => writePrivateFile(dir, file, `${JSON.stringify(data, null, 2)}\n`),
  };
}
