import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGithubIssues, repoChoices } from '../src/github-issues.js';

const ISSUE = {
  number: 51, title: 'CI takes 14 minutes', url: 'https://github.com/acme/storefront/issues/51', state: 'open',
  repository: { nameWithOwner: 'acme/storefront' }, updatedAt: '2026-11-10T09:00:00Z',
};

/** A gh that answers from `answers` (first two words → stdout, or an Error), recording every call. */
function fakeGh(answers) {
  const calls = [];
  const runGh = async (args) => {
    calls.push(args);
    const answer = answers[`${args[0]} ${args[1]}`];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(args) : answer ?? '';
  };
  return { runGh, calls };
}

const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('connection: signed in to gh as you, or not', async () => {
  assert.deepEqual(await createGithubIssues(fakeGh({ 'api user': 'dev\n' })).connection(), { connected: true, user: { username: 'dev' } });
  const out = createGithubIssues(fakeGh({ 'api user': new Error('gh: To get started with GitHub CLI, please run: gh auth login') }));
  assert.deepEqual(await out.connection(), { connected: false });
});

test('assigned: your open issues, from gh search, every value its own argument', async () => {
  const { runGh, calls } = fakeGh({ 'search issues': JSON.stringify([ISSUE]) });
  const result = await createGithubIssues({ runGh }).assigned();
  assert.deepEqual(calls[0], ['search', 'issues', '--assignee=@me', '--state=open', '--limit', '200', '--json', 'number,title,url,state,repository,updatedAt']);
  assert.deepEqual(result, {
    connected: true,
    tasks: [{
      id: 'acme/storefront#51', customId: null, name: 'CI takes 14 minutes', status: { name: 'open', color: null },
      dueAt: null, updatedAt: Date.parse('2026-11-10T09:00:00Z'), url: 'https://github.com/acme/storefront/issues/51', where: null,
    }],
  });
});

test('assigned: cached for a while; Refresh asks again', async () => {
  let now = 0;
  const { runGh, calls } = fakeGh({ 'search issues': JSON.stringify([ISSUE]) });
  const issues = createGithubIssues({ runGh, now: () => now });
  await issues.assigned();
  now = 30_000;
  await issues.assigned();
  assert.equal(calls.length, 1);
  await issues.assigned({ force: true });
  assert.equal(calls.length, 2);
});

test('assigned when gh is not signed in: not connected, not an error', async () => {
  const { runGh } = fakeGh({ 'search issues': new Error('gh: To get started with GitHub CLI, please run: gh auth login') });
  assert.deepEqual(await createGithubIssues({ runGh }).assigned(), { connected: false, tasks: [] });
});

test('assigned when GitHub fails otherwise: the error, with no tickets', async () => {
  const { runGh } = fakeGh({ 'search issues': new Error('HTTP 502') });
  const result = await createGithubIssues({ runGh }).assigned();
  assert.equal(result.connected, true);
  assert.match(result.error, /502/);
});

test('ticket: an issue, with the statuses it can move to', async () => {
  const body = JSON.stringify({ title: 'CI takes 14 minutes', body: 'Cache it.', state: 'OPEN', url: ISSUE.url });
  const { runGh, calls } = fakeGh({ 'issue view': body });
  const ticket = await createGithubIssues({ runGh }).ticket({ repo: 'acme/storefront', number: 51, kind: 'issue' }, ISSUE.url);
  assert.deepEqual(calls[0], ['issue', 'view', '51', '--repo', 'acme/storefront', '--json', 'title,body,state,url']);
  assert.deepEqual(ticket, {
    tracker: 'github', title: 'CI takes 14 minutes', status: { name: 'open', color: null }, description: 'Cache it.', url: ISSUE.url,
    statuses: [{ name: 'open', color: null }, { name: 'closed', color: null }],
  });
});

test('ticket: a PR is read, but its state is not changed from here', async () => {
  const { runGh } = fakeGh({ 'pr view': JSON.stringify({ title: 'Faster CI', body: '', state: 'OPEN', url: 'https://github.com/acme/storefront/pull/7' }) });
  const ticket = await createGithubIssues({ runGh }).ticket({ repo: 'acme/storefront', number: 7, kind: 'pr' }, 'https://github.com/acme/storefront/pull/7');
  assert.deepEqual(ticket.statuses, []);
});

test('setStatus: closes or reopens an issue with gh, then reads it again', async () => {
  const states = { 51: 'OPEN' };
  const { runGh, calls } = fakeGh({
    'issue close': (args) => { states[args[2]] = 'CLOSED'; return ''; },
    'issue reopen': (args) => { states[args[2]] = 'OPEN'; return ''; },
    'issue view': (args) => JSON.stringify({ title: 't', body: '', state: states[args[2]], url: ISSUE.url }),
  });
  const issues = createGithubIssues({ runGh });
  const ref = { repo: 'acme/storefront', number: 51, kind: 'issue' };
  assert.equal((await issues.setStatus(ref, ISSUE.url, 'Closed')).status.name, 'closed');
  assert.deepEqual(calls[0], ['issue', 'close', '51', '--repo', 'acme/storefront']);
  assert.equal((await issues.setStatus(ref, ISSUE.url, 'open')).status.name, 'open');
  assert.deepEqual(calls[2], ['issue', 'reopen', '51', '--repo', 'acme/storefront']);
});

test('setStatus refuses PRs and states an issue does not have', async () => {
  const { runGh, calls } = fakeGh({});
  const issues = createGithubIssues({ runGh });
  await rejectsWith(issues.setStatus({ repo: 'a/b', number: 1, kind: 'pr' }, 'https://github.com/a/b/pull/1', 'closed'), 400, /pull request/);
  await rejectsWith(issues.setStatus({ repo: 'a/b', number: 1, kind: 'issue' }, 'https://github.com/a/b/issues/1', 'merged'), 400);
  assert.equal(calls.length, 0);
});

test('a status change drops the cached list, so the picker sees it', async () => {
  const { runGh, calls } = fakeGh({ 'search issues': '[]', 'issue close': '', 'issue view': JSON.stringify({ title: 't', body: '', state: 'CLOSED', url: ISSUE.url }) });
  const issues = createGithubIssues({ runGh });
  await issues.assigned();
  await issues.setStatus({ repo: 'acme/storefront', number: 51, kind: 'issue' }, ISSUE.url, 'closed');
  await issues.assigned();
  assert.equal(calls.filter((c) => c[0] === 'search').length, 2);
});

test('assigned shows only the repos chosen in Settings (any case); none chosen shows every repo', async () => {
  const other = { ...ISSUE, number: 12, url: 'https://github.com/acme/billing-api/issues/12', repository: { nameWithOwner: 'acme/billing-api' } };
  const { runGh } = fakeGh({ 'search issues': JSON.stringify([ISSUE, other]) });
  let chosen = ['Acme/Billing-API'];
  const issues = createGithubIssues({ runGh, issueRepos: () => chosen });
  assert.deepEqual((await issues.assigned()).tasks.map((t) => t.id), ['acme/billing-api#12']);
  chosen = [];
  assert.deepEqual((await issues.assigned()).tasks.map((t) => t.id), ['acme/storefront#51', 'acme/billing-api#12'], 'a change in Settings applies to the cached list too');
});

test('repoChoices: the repos to tick, from your assigned issues and the repos in your folders, with any already chosen', () => {
  const tasks = [{ id: 'acme/storefront#51' }, { id: 'acme/storefront#58' }, { id: 'oss/lib#3' }];
  const choices = repoChoices(tasks, ['acme/storefront', 'acme/billing-api', null], ['old/gone']);
  assert.deepEqual(choices, [
    { name: 'acme/billing-api', issues: 0, local: true, chosen: false },
    { name: 'acme/storefront', issues: 2, local: true, chosen: false },
    { name: 'old/gone', issues: 0, local: false, chosen: true },
    { name: 'oss/lib', issues: 1, local: false, chosen: false },
  ]);
});

test('repoChoices matches names in any case, keeping the first spelling', () => {
  const choices = repoChoices([{ id: 'Acme/Storefront#1' }], ['acme/storefront'], ['ACME/storefront']);
  assert.deepEqual(choices, [{ name: 'Acme/Storefront', issues: 1, local: true, chosen: true }]);
});
