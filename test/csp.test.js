import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CSP, newStyleNonce, withStyleNonce } from '../src/csp.js';

test('withStyleNonce allows only <style> elements carrying the nonce, and gives the page the nonce', () => {
  const { csp, body } = withStyleNonce('<html><head><title>x</title></head></html>', 'abc123');
  assert.equal(csp, `${CSP}; style-src 'self' 'nonce-abc123'`);
  assert.ok(!csp.includes('unsafe-inline'));
  assert.ok(body.includes('<meta name="style-nonce" content="abc123">\n</head>'));
});

test('newStyleNonce is random on each load', () => {
  assert.notEqual(newStyleNonce(), newStyleNonce());
  assert.match(newStyleNonce(), /^[A-Za-z0-9+/]{22}==$/);
});
