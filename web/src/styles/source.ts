import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The pages' source text, for tests that check what it says. Read from disk,
 * from the folder vite.config.ts names (web/src): Vitest hands a `?raw` CSS
 * import over empty, so a check on one would pass whatever the file held, and
 * import.meta.url is a web address under jsdom, not the file's.
 */
function srcDir(): string {
  const dir = process.env.SRC_DIR;
  if (!dir) throw new Error('SRC_DIR is not set; run the tests with web/vite.config.ts');
  return dir;
}

/** A file's text, by its path under web/src. */
export const sourceText = (path: string): string => readFileSync(join(srcDir(), path), 'utf8');

/** The files in a folder under web/src, by name. */
export const sourceFiles = (dir: string): string[] => readdirSync(join(srcDir(), dir));

/** A stylesheet's text. */
export const cssSource = (name: 'app' | 'base' | 'themes'): string => sourceText(`styles/${name}.css`);
