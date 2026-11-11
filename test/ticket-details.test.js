import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTicketDetails, parseTicketLink } from '../src/ticket-details.js';

test('parseTicketLink: ClickUp and GitHub tickets switchyard can read; other trackers by name', () => {
  assert.deepEqual(parseTicketLink('https://app.clickup.com/t/86b4fx5'), { tracker: 'clickup', key: '86b4fx5' });
  assert.deepEqual(parseTicketLink('https://app.clickup.com/t/9012345/SHOP-31'), { tracker: 'clickup', key: 'SHOP-31' });
  assert.deepEqual(parseTicketLink('https://github.com/acme/storefront/issues/51'), { tracker: 'github', repo: 'acme/storefront', number: 51, kind: 'issue' });
  assert.deepEqual(parseTicketLink('https://github.com/acme/store.front_2/pull/7#discussion'), { tracker: 'github', repo: 'acme/store.front_2', number: 7, kind: 'pr' });
  assert.deepEqual(parseTicketLink('https://acme.atlassian.net/browse/SHOP-17'), { tracker: 'jira' });
  assert.deepEqual(parseTicketLink('https://example.com/spec'), { tracker: null });
});

test('parseTicketLink refuses anything that could reach gh as an option or another host', () => {
  for (const link of [
    'https://github.com/-R/x/issues/1', 'https://github.com/acme/--repo/issues/1', 'https://github.com/a/b/issues/1x',
    'https://github.example.com/a/b/issues/1', 'http://github.com/a/b/issues/1', 'not a url', 'javascript:alert(1)',
  ]) {
    assert.equal(parseTicketLink(link).tracker === 'github', false, link);
  }
});

function setup({ gh = '{}' } = {}) {
  const calls = [];
  const details = createTicketDetails({
    taskTools: {
      clickupTicket: async (key) => { calls.push(['clickup', key]); return { tracker: 'clickup', id: key }; },
      setClickupStatus: async (body) => { calls.push(['status', body]); return { tracker: 'clickup', status: { name: body.status } }; },
    },
    runGh: async (args) => { calls.push(['gh', ...args]); return gh; },
  });
  return { details, calls };
}

test('get: a ClickUp ticket comes from ClickUp', async () => {
  const { details, calls } = setup();
  assert.deepEqual(await details.get('https://app.clickup.com/t/86b4fx5'), { tracker: 'clickup', id: '86b4fx5' });
  assert.deepEqual(calls, [['clickup', '86b4fx5']]);
});

test('get: a GitHub issue or PR comes from gh, every value its own argument', async () => {
  const body = JSON.stringify({ title: 'Faster CI', body: 'Cache **node_modules**.', state: 'OPEN', url: 'https://github.com/acme/storefront/issues/51' });
  const { details, calls } = setup({ gh: body });
  assert.deepEqual(await details.get('https://github.com/acme/storefront/issues/51'), {
    tracker: 'github', title: 'Faster CI', status: { name: 'open', color: null }, description: 'Cache **node_modules**.', url: 'https://github.com/acme/storefront/issues/51',
  });
  assert.deepEqual(calls, [['gh', 'issue', 'view', '51', '--repo', 'acme/storefront', '--json', 'title,body,state,url']]);
  await details.get('https://github.com/acme/storefront/pull/7');
  assert.deepEqual(calls[1].slice(0, 3), ['gh', 'pr', 'view']);
});

test('get: other links are not read, only linked to', async () => {
  const { details, calls } = setup();
  assert.deepEqual(await details.get('https://acme.atlassian.net/browse/SHOP-17'), { tracker: 'jira', supported: false, url: 'https://acme.atlassian.net/browse/SHOP-17' });
  assert.deepEqual(calls, []);
  await assert.rejects(details.get(42), (error) => error.status === 400);
});

test('setStatus: only for ClickUp tickets', async () => {
  const { details, calls } = setup();
  await details.setStatus({ url: 'https://app.clickup.com/t/9012345/SHOP-31', status: 'complete' });
  assert.deepEqual(calls, [['status', { key: 'SHOP-31', status: 'complete' }]]);
  await assert.rejects(details.setStatus({ url: 'https://github.com/a/b/issues/1', status: 'closed' }), (error) => error.status === 400);
});
