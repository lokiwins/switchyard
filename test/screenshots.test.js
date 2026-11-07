import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBranchPrQuery } from '../src/github.js';
import { respond } from '../scripts/screenshots/fake-gh.mjs';
import { COMMENT_MARKER, classify, prComment, releaseAssetName, releaseSection } from '../scripts/screenshots/report.mjs';

const pr = (fields) => ({
  number: 1, title: 'A change', state: 'OPEN', headRefName: 'feat/a', author: { login: 'dev' },
  repository: { nameWithOwner: 'acme/app', name: 'app' }, ...fields,
});
const fixture = {
  viewer: 'dev',
  prs: [
    pr({ number: 1, headRefName: 'feat/a' }),
    pr({ number: 2, headRefName: 'feat/b', state: 'MERGED' }),
    pr({ number: 3, headRefName: 'other', author: { login: 'sam' }, requestedOfViewer: 'direct' }),
    pr({ number: 4, headRefName: 'team', author: { login: 'lee' }, requestedOfViewer: 'team' }),
  ],
};

test('fake gh answers a batched branch query by repo and branch, as switchyard sends it', () => {
  const { query, variables } = buildBranchPrQuery([{ repo: 'acme/app', branches: ['feat/a', 'missing'] }]);
  const args = ['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([k, v]) => ['-f', `${k}=${v}`])];
  const { data } = JSON.parse(respond(args, fixture));
  assert.deepEqual(data.r0.b0.nodes.map((p) => p.number), [1]);
  assert.deepEqual(data.r0.b1.nodes, []);
});

test('fake gh searches open PRs by author and review request, returning only the asked fields', () => {
  const search = (qualifier) => JSON.parse(respond(['search', 'prs', qualifier, '--state=open', '--json', 'number,title'], fixture));
  assert.deepEqual(search('--author=@me'), [{ number: 1, title: 'A change' }]);
  assert.deepEqual(search('user-review-requested:@me').map((p) => p.number), [3]);
  assert.deepEqual(search('--review-requested=@me').map((p) => p.number), [3, 4]);
});

test('fake gh lists a repo\'s PRs by state and author, as releases before the batched query did', () => {
  const list = (...extra) => JSON.parse(respond(['pr', 'list', '--repo', 'acme/app', '--json', 'number', ...extra], fixture))
    .map((p) => p.number);
  assert.deepEqual(list('--state', 'open', '--limit', '100'), [1, 3, 4]);
  assert.deepEqual(list('--author', '@me', '--state', 'all', '--limit', '30'), [1, 2]);
  assert.deepEqual(JSON.parse(respond(['pr', 'list', '--repo', 'acme/other', '--json', 'number'], fixture)), []);
});

test('fake gh views a PR, reports the viewer, and fails on calls it does not know', () => {
  assert.deepEqual(JSON.parse(respond(['pr', 'view', '2', '--repo', 'acme/app', '--json', 'number,state'], fixture)), { number: 2, state: 'MERGED' });
  assert.throws(() => respond(['pr', 'view', '9', '--repo', 'acme/app', '--json', 'number'], fixture), /no pull requests found/);
  assert.equal(respond(['api', 'user', '--jq', '.login'], fixture), 'dev\n');
  assert.throws(() => respond(['repo', 'delete'], fixture), /unsupported call/);
});

const shot = (title, ok = true, error) => ({ title, ok, ...(error ? { error } : {}) });

test('classify marks scenes new, changed, same, failed and removed', () => {
  const base = { a: shot('A'), b: shot('B'), gone: shot('Gone'), broken: shot('Broken', false, 'timeout') };
  const head = { a: shot('A'), b: shot('B'), fresh: shot('Fresh'), broken: shot('Broken'), bad: shot('Bad', false, 'timeout') };
  const statuses = Object.fromEntries(classify(base, head, { a: true, b: false, broken: true }).map((e) => [e.name, e.status]));
  assert.deepEqual(statuses, { a: 'changed', b: 'same', fresh: 'new', broken: 'new', bad: 'failed', gone: 'removed' });
});

test('every scene is new when there is no base capture, e.g. the first release', () => {
  assert.deepEqual(classify({}, { a: shot('A') }, {}).map((e) => e.status), ['new']);
});

const imageUrl = (side, name) => `https://img.test/${side}/${name}.png`;

test('the PR comment shows before and after for changed scenes and only after for new ones', () => {
  const body = prComment([
    { name: 'a', title: 'Page A', status: 'changed' },
    { name: 'b', title: 'Page B', status: 'new' },
    { name: 'c', title: 'Page C', status: 'same' },
  ], { imageUrl, uiChanged: true, baseRef: 'main' });
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /Page A \(changed\)[\s\S]*base\/a\.png[\s\S]*head\/a\.png/);
  assert.match(body, /Page B \(new\)/);
  assert.doesNotMatch(body, /base\/b\.png/);
  assert.match(body, /Unchanged: `c`/);
  assert.doesNotMatch(body, /add or update a scene/);
});

test('the PR comment asks for a scene when UI files change but no screenshot does', () => {
  const entries = [{ name: 'a', title: 'A', status: 'same' }];
  assert.match(prComment(entries, { imageUrl, uiChanged: true, baseRef: 'main' }), /add or update a scene/);
  assert.match(prComment(entries, { imageUrl, uiChanged: false, baseRef: 'main' }), /Nothing looks different from `main`/);
});

test('the PR comment lists scenes that could not be captured', () => {
  const body = prComment([{ name: 'a', title: 'A', status: 'failed', error: 'Timeout' }], { imageUrl, uiChanged: false, baseRef: 'main' });
  assert.match(body, /Could not capture:\*\*\n- `a`: Timeout/);
});

test('release notes show the current screenshot of new and changed scenes, or nothing', () => {
  const section = releaseSection([
    { name: 'a', title: 'Page A', status: 'changed' },
    { name: 'b', title: 'Page "B"', status: 'new' },
    { name: 'c', title: 'Page C', status: 'same' },
  ], { imageUrl });
  assert.match(section, /^## Screenshots/);
  assert.match(section, /### Page A\n\n<img alt="Page A" src="https:\/\/img\.test\/head\/a\.png"/);
  assert.match(section, /### Page "B" \(new\)\n\n<img alt="Page &quot;B&quot;"/);
  assert.doesNotMatch(section, /Page C/);
  assert.equal(releaseSection([{ name: 'c', title: 'C', status: 'same' }], { imageUrl }), '');
});

test('release screenshots are named for the release they are attached to', () => {
  assert.equal(releaseAssetName('review-pane'), 'screenshot-review-pane.png');
});
