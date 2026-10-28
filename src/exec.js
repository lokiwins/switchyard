import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** Run a command without a shell and resolve with stdout. */
export function run(cmd, args, { cwd, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: MAX_BUFFER_BYTES }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Map over items with at most `limit` promises in flight, preserving order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
