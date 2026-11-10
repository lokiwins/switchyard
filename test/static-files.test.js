import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import { STATIC_FILES } from '../src/static-files.js';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const SCRIPT_SRC = /<script[^>]*\ssrc="([^"]+)"/g;
const STYLESHEET = /<link[^>]*\shref="([^"]+)"/g;
const IMPORT = /\bfrom\s+'(\.[^']+)'/g;
// Files a module loads by an absolute path held in a constant (the vendored terminal).
const ABSOLUTE_PATH = /'(\/vendor\/[^']+)'/g;

/** Every URL path a page loads, following module imports from its scripts. */
function pathsLoadedBy(page) {
  const html = readFileSync(join(PUBLIC_DIR, page), 'utf8');
  const pending = [...html.matchAll(SCRIPT_SRC), ...html.matchAll(STYLESHEET)].map((m) => m[1]);
  const seen = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!path.endsWith('.js')) continue;
    const source = readFileSync(join(PUBLIC_DIR, path), 'utf8');
    for (const [, relative] of source.matchAll(IMPORT)) pending.push(posix.join(posix.dirname(path), relative));
    for (const [, absolute] of source.matchAll(ABSOLUTE_PATH)) pending.push(absolute);
  }
  return [...seen];
}

test('every file a page loads is served, so no module is left out', () => {
  for (const page of ['agents.html', 'worktrees.html', 'prs.html', 'tasks.html']) {
    for (const path of pathsLoadedBy(page)) {
      assert.equal(STATIC_FILES[path], path.slice(1), `${page} loads ${path}, which isn't in src/static-files.js`);
    }
  }
});

test('every listed file exists in public/', () => {
  for (const file of Object.values(STATIC_FILES)) assert.ok(existsSync(join(PUBLIC_DIR, file)), `public/${file} is missing`);
});
