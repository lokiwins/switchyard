import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildBranchPrQuery, fetchBranchPrs, isCopilotLogin, parseGithubRemote, summarizeChecks, summarizeReviews,
} from '../src/github.js';

test('parseGithubRemote handles ssh and https remotes', () => {
  assert.equal(parseGithubRemote('git@github.com:acme-inc/web-app.git'), 'acme-inc/web-app');
  assert.equal(parseGithubRemote('https://github.com/org/repo'), 'org/repo');
  assert.equal(parseGithubRemote('https://github.com/org/repo.git/'), 'org/repo');
  assert.equal(parseGithubRemote('ssh://git@github.com/org/my.repo.git'), 'org/my.repo');
});

test('parseGithubRemote returns null for non-GitHub or missing remotes', () => {
  assert.equal(parseGithubRemote('git@gitlab.com:org/repo.git'), null);
  assert.equal(parseGithubRemote(null), null);
});

test('summarizeChecks reports failing when any check fails', () => {
  const summary = summarizeChecks([
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'StatusContext', context: 'ci/build', state: 'ERROR', targetUrl: 'https://ci/1' },
  ]);
  assert.equal(summary.state, 'failing');
  assert.deepEqual([summary.passing, summary.failing, summary.pending, summary.total], [1, 1, 1, 3]);
  assert.deepEqual(summary.failed, [{ name: 'ci/build', label: 'ci/build', url: 'https://ci/1' }]);
  assert.deepEqual(summary.running, [{ name: 'e2e', label: 'e2e', url: null }]);
});

test('summarizeChecks treats skipped and neutral runs as passing', () => {
  const summary = summarizeChecks([
    { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { __typename: 'StatusContext', context: 'c', state: 'SUCCESS' },
  ]);
  assert.equal(summary.state, 'passing');
});

test('summarizeChecks reports pending and none', () => {
  assert.equal(summarizeChecks([{ __typename: 'StatusContext', context: 'x', state: 'PENDING' }]).state, 'pending');
  assert.equal(summarizeChecks([]).state, 'none');
  assert.equal(summarizeChecks(undefined).state, 'none');
});

test('summarizeChecks ignores results superseded by a re-run', () => {
  const summary = summarizeChecks([
    { __typename: 'CheckRun', workflowName: 'CI', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-01-01T00:00:00Z' },
    { __typename: 'CheckRun', workflowName: 'CI', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-01-01T01:00:00Z' },
    { __typename: 'CheckRun', workflowName: 'Other', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(summary.state, 'passing');
  assert.equal(summary.total, 2);
});

test('summarizeReviews keeps decisive reviews and lists user and team requests', () => {
  const { reviews, requested } = summarizeReviews(
    [
      { author: { login: 'alice' }, state: 'APPROVED', submittedAt: '2026-01-01T00:00:00Z' },
      { author: { login: 'bot' }, state: 'COMMENTED' },
      { author: { login: 'carol' }, state: 'PENDING' },
    ],
    [{ __typename: 'User', login: 'bob' }, { __typename: 'Team', slug: 'org/eng', name: 'eng' }],
  );
  assert.deepEqual(reviews.map((r) => [r.login, r.state]), [['alice', 'APPROVED'], ['bot', 'COMMENTED']]);
  assert.deepEqual(requested, [{ name: 'bob', isTeam: false }, { name: 'org/eng', isTeam: true }]);
});

test('summarizeChecks treats manual approval holds and jobs queued behind them as held', () => {
  const pending = (context) => ({ __typename: 'StatusContext', context, state: 'PENDING' });
  const summary = summarizeChecks([
    { __typename: 'StatusContext', context: 'ci/circleci: deploy/build', state: 'SUCCESS' },
    pending('ci/circleci: deploy/deploy_staging_hold'),
    pending('ci/circleci: deploy/migrate_staging_db'),
    pending('ci/circleci: release/Approve Production Deploy'),
    pending('ci/circleci: other/unit_tests'),
  ]);
  assert.equal(summary.heldCount, 3);
  assert.deepEqual(summary.running.map((c) => c.name), ['ci/circleci: other/unit_tests']);
  assert.equal(summary.state, 'pending');

  const onlyHeld = summarizeChecks([
    { __typename: 'StatusContext', context: 'ci/circleci: w/test', state: 'SUCCESS' },
    pending('ci/circleci: w/Approve Deploy'),
  ]);
  assert.equal(onlyHeld.state, 'passing');
});

test('isCopilotLogin matches the Copilot reviewer with or without the bot suffix', () => {
  assert.equal(isCopilotLogin('copilot-pull-request-reviewer'), true);
  assert.equal(isCopilotLogin('copilot-pull-request-reviewer[bot]'), true);
  assert.equal(isCopilotLogin('copilot'), false);
  assert.equal(isCopilotLogin(undefined), false);
});

const requests = [
  { repo: 'acme/web', branches: ['feat-a', 'fix/b'] },
  { repo: 'acme/api', branches: ['feat-c'] },
];

test('buildBranchPrQuery asks for every branch in one query, with all values as variables', () => {
  const { query, variables } = buildBranchPrQuery(requests);
  assert.deepEqual(variables, {
    o0: 'acme', n0: 'web', b0_0: 'feat-a', b0_1: 'fix/b', o1: 'acme', n1: 'api', b1_0: 'feat-c',
  });
  assert.match(query, /r0: repository\(owner: \$o0, name: \$n0\)/);
  assert.match(query, /b1: pullRequests\(headRefName: \$b0_1, /);
  assert.match(query, /r1: repository\(owner: \$o1, name: \$n1\) \{ b0: pullRequests\(headRefName: \$b1_0, /);
  for (const value of Object.values(variables)) assert.equal(query.includes(value), false);
});

const node = (number, headRefName, state = 'OPEN') => ({ number, headRefName, state, title: `PR ${number}` });
const response = {
  data: {
    r0: { b0: { nodes: [node(1, 'feat-a')] }, b1: { nodes: [] } },
    r1: { b0: { nodes: [node(7, 'feat-c', 'MERGED'), node(3, 'feat-c', 'CLOSED')] } },
  },
};

test('fetchBranchPrs makes one gh call and returns each repo\'s PRs', async () => {
  const calls = [];
  const result = await fetchBranchPrs(requests, {
    runGh: async (args) => { calls.push(args); return JSON.stringify(response); },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.ok(calls[0].includes('b0_1=fix/b'));
  assert.deepEqual(result.byRepo['acme/web'].map((pr) => pr.number), [1]);
  assert.deepEqual(result.byRepo['acme/api'].map((pr) => pr.number), [7, 3]);
  assert.deepEqual(result.errors, []);
});

test('fetchBranchPrs retries repo by repo when the batch fails, so one bad repo only loses its own PRs', async () => {
  const result = await fetchBranchPrs(requests, {
    runGh: async (args) => {
      if (args.includes('n1=api') && args.includes('n0=web')) throw new Error('Could not resolve to a Repository');
      if (args.includes('n0=api')) throw new Error('Could not resolve to a Repository');
      return JSON.stringify({ data: { r0: { b0: { nodes: [node(1, 'feat-a')] }, b1: { nodes: [] } } } });
    },
  });
  assert.deepEqual(result.byRepo['acme/web'].map((pr) => pr.number), [1]);
  assert.equal(result.byRepo['acme/api'], undefined);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /acme\/api/);
});

test('fetchBranchPrs splits very large batches', async () => {
  const many = [{ repo: 'acme/web', branches: Array.from({ length: 150 }, (_, i) => `b${i}`) }, { repo: 'acme/api', branches: ['x'] }];
  let calls = 0;
  await fetchBranchPrs(many, { runGh: async () => { calls += 1; return JSON.stringify({ data: {} }); } });
  assert.equal(calls, 2);
});
