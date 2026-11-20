import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtFile, BUILT_PAGES } from '../src/built-pages.js';

test('the pages built from web/ are served at their addresses', () => {
  assert.deepEqual(BUILT_PAGES, { '/': 'agents.html', '/prs': 'prs.html' });
  assert.deepEqual(builtFile('/'), { file: 'agents.html', page: true });
  assert.deepEqual(builtFile('/prs'), { file: 'prs.html', page: true });
});

test('hashed assets are served from the build, and nothing else is', () => {
  assert.deepEqual(builtFile('/assets/agents-4GCvw0nE.js'), { file: 'assets/agents-4GCvw0nE.js', page: false });
  assert.deepEqual(builtFile('/assets/xterm-BrP-ENHg.css'), { file: 'assets/xterm-BrP-ENHg.css', page: false });
  for (const path of ['/assets/../package.json', '/assets/x/y.js', '/assets/.hidden.js', '/assets/a.map', '/assets/', '/agents.html', '/prs.html', '/tasks']) {
    assert.equal(builtFile(path), null, path);
  }
});
