import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const WEB_DIR = join(ROOT, 'web');
// What a built page loads from outside the build: the tags the build leaves alone (vite-ignore).
const KEPT_TAG = /<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"[^>]*\svite-ignore/g;
const FONT_URL = /url\((\.\.\/fonts\/[^)]+)\)/g;

const pages = readdirSync(WEB_DIR).filter((file) => file.endsWith('.html'));

test('the one file a built page loads from outside the build is the theme boot script, which the server sends', () => {
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = readFileSync(join(WEB_DIR, page), 'utf8');
    assert.deepEqual([...html.matchAll(KEPT_TAG)].map((m) => m[1]), ['/theme-boot.js'], page);
  }
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(ROOT, 'public', 'theme-boot.js')], { stdio: 'pipe' }));
});

test('every font a theme loads is in the build, with its licence', () => {
  const styles = join(WEB_DIR, 'src', 'styles');
  const fonts = [...readFileSync(join(styles, 'themes.css'), 'utf8').matchAll(FONT_URL)].map((m) => m[1]);
  assert.equal(fonts.length, 4);
  for (const font of fonts) assert.ok(existsSync(join(styles, font)), `themes.css loads ${font}, which is missing`);
  assert.equal(readdirSync(join(styles, '..', 'fonts')).filter((f) => f.startsWith('OFL-')).length, 4);
});
