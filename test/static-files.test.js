import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STATIC_FILES } from '../src/static-files.js';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const WEB_DIR = join(ROOT, 'web');
// What a built page loads from public/: the tags the build leaves alone (vite-ignore).
const KEPT_TAG = /<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"[^>]*\svite-ignore/g;
const FONT_URL = /url\((\/vendor\/fonts\/[^)]+)\)/g;

const pages = readdirSync(WEB_DIR).filter((file) => file.endsWith('.html'));

test('every file a built page loads from public/ is served', () => {
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = readFileSync(join(WEB_DIR, page), 'utf8');
    for (const [, path] of html.matchAll(KEPT_TAG)) assert.equal(STATIC_FILES[path], path.slice(1), `${page} loads ${path}, which isn't in src/static-files.js`);
  }
});

test('every font a theme loads is served', () => {
  for (const [, path] of readFileSync(join(PUBLIC_DIR, 'themes.css'), 'utf8').matchAll(FONT_URL)) {
    assert.equal(STATIC_FILES[path], path.slice(1), `themes.css loads ${path}, which isn't in src/static-files.js`);
  }
});

test('every listed file exists in public/, and the theme boot script parses', () => {
  for (const file of Object.values(STATIC_FILES)) assert.ok(existsSync(join(PUBLIC_DIR, file)), `public/${file} is missing`);
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(PUBLIC_DIR, 'theme-boot.js')], { stdio: 'pipe' }));
});
