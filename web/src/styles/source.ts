import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * A stylesheet's text, for tests that check what it says. Read from disk, from
 * the folder vite.config.ts names: Vitest hands a `?raw` CSS import over empty,
 * so a check on one would pass whatever the file held.
 */
export function cssSource(name: 'app' | 'base' | 'themes'): string {
  const dir = process.env.STYLES_DIR;
  if (!dir) throw new Error('STYLES_DIR is not set; run the tests with web/vite.config.ts');
  return readFileSync(join(dir, `${name}.css`), 'utf8');
}
