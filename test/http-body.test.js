import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { DRAIN_LIMIT_BYTES, readJsonBody } from '../src/http-body.js';

async function withServer(maxBytes, run) {
  const server = createServer(async (req, res) => {
    try {
      res.end(JSON.stringify(await readJsonBody(req, maxBytes)));
    } catch (error) {
      res.writeHead(error.status, { Connection: 'close' });
      res.end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    server.close();
  }
}

test('a body within the limit is parsed; an empty one is {}; bad JSON is a 400', async () => {
  await withServer(100, async (url) => {
    assert.deepEqual(await (await fetch(url, { method: 'POST', body: '{"a":1}' })).json(), { a: 1 });
    assert.deepEqual(await (await fetch(url, { method: 'POST', body: '' })).json(), {});
    assert.equal((await fetch(url, { method: 'POST', body: '{' })).status, 400);
  });
});

test('a body over the limit gets a 413 the client can read', async () => {
  await withServer(100, async (url) => {
    assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(10_000) })).status, 413);
  });
});

test('one far over the limit isn\'t read to its end: the connection is cut', async () => {
  await withServer(100, async (url) => {
    const huge = 'x'.repeat(DRAIN_LIMIT_BYTES + 1024 * 1024);
    const outcome = await fetch(url, { method: 'POST', body: huge }).then((res) => res.status, () => 'cut');
    assert.ok(outcome === 'cut' || outcome === 413, String(outcome));
  });
});
