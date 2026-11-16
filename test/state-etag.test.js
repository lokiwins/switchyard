import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionalState, ifNoneMatchHit, stateEtag } from '../src/state-etag.js';

const STATE = {
  generatedAt: 1000,
  repos: [{ name: 'shop', worktrees: [{ path: '/code/shop', branch: 'main' }] }],
  nav: { agents: 1 },
  errors: [],
};

test('stateEtag: a quoted tag that ignores when the state was built', () => {
  const tag = stateEtag(STATE);
  assert.match(tag, /^"[0-9a-f]{16}"$/);
  assert.equal(stateEtag({ ...STATE, generatedAt: 9999 }), tag);
});

test('stateEtag: changes when anything else changes, the header badges included', () => {
  const tag = stateEtag(STATE);
  assert.notEqual(stateEtag({ ...STATE, nav: { agents: 2 } }), tag);
  assert.notEqual(stateEtag({ ...STATE, errors: [{ source: 'git', message: 'x' }] }), tag);
  const moved = { ...STATE, repos: [{ ...STATE.repos[0], worktrees: [{ path: '/code/shop', branch: 'fix' }] }] };
  assert.notEqual(stateEtag(moved), tag);
});

test('ifNoneMatchHit: the tag, in a list, weak, or *; nothing else', () => {
  const tag = '"abc"';
  assert.equal(ifNoneMatchHit('"abc"', tag), true);
  assert.equal(ifNoneMatchHit('"x", "abc"', tag), true);
  assert.equal(ifNoneMatchHit('W/"abc"', tag), true);
  assert.equal(ifNoneMatchHit('*', tag), true);
  assert.equal(ifNoneMatchHit('"abd"', tag), false);
  assert.equal(ifNoneMatchHit('', tag), false);
  assert.equal(ifNoneMatchHit(undefined, tag), false);
});

test('conditionalState: the same version the page has → 304, no body, with the tag and when it was built', () => {
  const answer = conditionalState(stateEtag(STATE), { ...STATE, generatedAt: 2000 });
  assert.equal(answer.status, 304);
  assert.equal(answer.body, undefined);
  assert.deepEqual(answer.headers, { ETag: stateEtag(STATE), 'X-Generated-At': '2000' });
});

test('conditionalState: a different or missing version → 200 with the whole state as the body', () => {
  for (const sent of [undefined, '"old"']) {
    const answer = conditionalState(sent, STATE);
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), { success: true, data: STATE });
    assert.deepEqual(answer.headers, { ETag: stateEtag(STATE), 'X-Generated-At': '1000' });
  }
});
