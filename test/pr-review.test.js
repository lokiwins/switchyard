import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPrReviews, prFacts, prReviewerSettings, reviewCheckoutPath } from '../src/pr-review.js';

const SESSION = '0b6f1c2e-4a8d-4c1e-9f3a-2d5e6f7a8b9c';
const SESSION_2 = '1c7a2d3f-5b9e-4d2f-8a4b-3e6f7a8b9c0d';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();

/** An origin with main and a PR head at refs/pull/7/head, and a clone of it (the repo's main checkout). */
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'switchyard-pr-review-')));
  const work = join(root, 'work');
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
  writeFileSync(join(work, 'totals.js'), 'export const round = Math.round;\n');
  git(work, 'checkout', '-q', '-b', 'fix-totals');
  git(work, 'add', '.');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'round half up');
  const head = git(work, 'rev-parse', 'HEAD');
  const origin = join(root, 'origin.git');
  git(root, 'clone', '-q', '--bare', work, origin);
  git(origin, 'update-ref', 'refs/pull/7/head', head);
  git(origin, 'branch', '-q', '-D', 'fix-totals');
  const code = join(root, 'code');
  mkdirSync(code);
  const main = join(code, 'shop');
  git(code, 'clone', '-q', origin, main);
  return { root, main, head, dir: join(root, 'config') };
}

const PR = {
  number: 7, title: 'Round totals half up', body: 'Totals were off by a cent.', url: 'https://github.com/acme/shop/pull/7',
  author: { login: 'sam' }, baseRefName: 'main', headRefName: 'fix-totals', state: 'OPEN', files: [{ path: 'totals.js' }],
};

function setup({ pr = PR, others = {}, live = () => [], summaries = {}, instructions = 'Review {{pr.repo}}#{{pr.number}}: {{pr.title}}\n{{pr.files}}', states = {}, broken = {}, listed = { repo: true } } = {}) {
  const w = world();
  const typed = [];
  const ended = [];
  const tracked = [];
  const tmux = {
    hasWindow: async () => false,
    newWindow: async (options) => {
      if (broken.tmux) throw new Error('no server running');
      typed.push(['window', options]);
      return { window: '@9', pane: '%9' };
    },
    sendLine: async (pane, text) => typed.push(['type', pane, text]),
    killWindow: async () => {},
  };
  const provider = {
    label: 'Claude Code', takesLaunchOptions: true, command: 'claude',
    launchCommand: (prompt, options) => JSON.stringify({ prompt, ...options }),
  };
  // The repos as switchyard lists them: the review checkout appears once git has it.
  const getRepos = async () => {
    if (!listed.repo) return [];
    const paths = git(w.main, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
    return [{
      name: 'shop', mainPath: w.main, github: 'acme/shop',
      worktrees: paths.map((path) => ({ path, isMain: path === w.main, agents: { live: live(path), recent: [] } })),
    }];
  };
  const ids = [SESSION, SESSION_2];
  let clock = 1_000_000;
  const reviews = createPrReviews({
    getRepos,
    tmux,
    provider: () => provider,
    fetchPr: async (ref) => {
      if (ref.number !== 7) return others[ref.number];
      assert.deepEqual(ref, { repo: 'acme/shop', number: 7 });
      return pr;
    },
    fetchState: async (ref) => states[`${ref.repo}#${ref.number}`] ?? 'OPEN',
    readReply: async (cwd, id) => summaries[id] ?? null,
    instructions: () => instructions,
    dir: w.dir,
    endSession: async (body) => { ended.push(body); return { ended: true }; },
    starts: { track: (start) => tracked.push(start) },
    newSessionId: () => ids.shift(),
    now: () => clock,
    gitEnv: { GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  return { ...w, reviews, others, typed, ended, tracked, tick: (ms) => { clock += ms; } };
}

test('a review checkout sits next to the repo\'s main checkout, named for the PR', () => {
  assert.equal(reviewCheckoutPath({ mainPath: '/code/shop' }, 7), '/code/shop-review-7');
});

test('a PR\'s reviewer reads its checkout and its instructions without asking, and nothing else; secrets never', () => {
  const { allow, deny } = prReviewerSettings('/home/me/.config/switchyard').permissions;
  for (const rule of ['Read(./**)', 'Read(//home/me/.config/switchyard/pr-reviews/**)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(ls:*)']) assert.ok(allow.includes(rule), rule);
  for (const rule of ['Read', 'Grep', 'Glob', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)']) assert.ok(!allow.includes(rule), rule);
  for (const rule of ['Edit', 'Write', 'Bash(git * --output*)', 'Bash(git * --no-index*)', 'Read(~/.ssh/**)', 'Read(~/.config/gh/**)']) assert.ok(deny.includes(rule), rule);
});

test('prFacts: what the instructions are filled with, from gh\'s answer', () => {
  assert.deepEqual(prFacts({ repo: 'acme/shop', number: 7 }, PR), {
    repo: 'acme/shop', number: 7, title: 'Round totals half up', url: 'https://github.com/acme/shop/pull/7', author: 'sam',
    base: 'main', head: 'fix-totals', body: 'Totals were off by a cent.', files: ['totals.js'],
  });
  assert.equal(prFacts({ repo: 'a/b', number: 1 }, { ...PR, author: null, body: null, files: undefined }).author, 'unknown');
});

test('Review checks the PR out in its own worktree at its head, and starts a read-only reviewer there', async () => {
  const { reviews, main, head, typed, tracked, dir } = setup();
  const started = await reviews.start({ repo: 'acme/shop', number: 7 });
  const path = `${main}-review-7`;
  assert.deepEqual(started, { sessionId: SESSION, window: 'review-shop-7', path });
  assert.equal(git(path, 'rev-parse', 'HEAD'), head);
  assert.ok(existsSync(join(path, 'totals.js')));
  assert.match(git(path, 'rev-parse', '--verify', 'origin/main'), /^[0-9a-f]{40}$/, 'the base is fetched to compare with');

  const [[, window], [, , command]] = typed;
  assert.deepEqual(window, { session: 'switchyard', name: 'review-shop-7', cwd: path });
  const launch = JSON.parse(command);
  assert.equal(launch.sessionId, SESSION);
  assert.equal(launch.name, 'PR review · shop#7');
  assert.equal(launch.permissionMode, 'manual');
  assert.equal(launch.isolated, true, 'the PR\'s own settings and your MCP servers stay out');
  assert.deepEqual(JSON.parse(readFileSync(launch.settings, 'utf8')), prReviewerSettings(dir));
  assert.ok(!launch.prompt.includes('\n'), 'one line, typed after claude');

  const file = join(dir, 'pr-reviews', 'acme__shop-7.md');
  assert.ok(launch.prompt.includes(file), launch.prompt);
  assert.match(launch.prompt, /Don't change any files or post anything to GitHub/);
  assert.equal(readFileSync(file, 'utf8'), 'Review acme/shop#7: Round totals half up\n- totals.js');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(tracked.map((t) => t.path), [path]);
});

test('its status: reviewing while the session runs, then the verdict it ends on', async () => {
  const running = new Set([SESSION]);
  const summaries = {};
  const { reviews, main, tick } = setup({ live: (path) => (path.endsWith('-review-7') ? [...running].map((sessionId) => ({ sessionId, needsYou: false })) : []), summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  const key = 'acme/shop#7';
  let page = await reviews.forPage();
  assert.equal(page.statusOf(key).state, 'reviewing');
  assert.equal(page.statusOf(key).session.sessionId, SESSION);
  assert.equal(page.statusOf(key).path, `${main}-review-7`);
  assert.equal(page.canReview('acme/shop'), true);
  assert.equal(page.canReview('acme/other'), false);
  assert.equal(page.statusOf('acme/shop#8'), null);

  summaries[SESSION] = '**Summary:** small.\n\n**Verdict:** `Request Changes`: rounding skips negatives.';
  running.clear();
  page = await reviews.forPage();
  assert.equal(page.statusOf(key).state, 'changes');
  assert.match(page.statusOf(key).summary, /rounding skips negatives/);
  assert.equal(page.statusOf(key).session, null);

  // A long report: its verdict, at the end, is still read.
  summaries[SESSION] = `**Summary:** ${'detail '.repeat(500)}\n\n**Verdict:** \`Approve\``;
  page = await reviews.forPage();
  assert.equal(page.statusOf(key).state, 'approve');
  assert.ok(page.statusOf(key).summary.length > 3000, 'the report in full');

  delete summaries[SESSION];
  tick(3 * 60_000);
  page = await reviews.forPage();
  assert.equal(page.statusOf(key).state, 'no verdict');
});

test('a reviewer waiting on you says so', async () => {
  const { reviews } = setup({ live: (path) => (path.endsWith('-review-7') ? [{ sessionId: SESSION, needsYou: true }] : []) });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.equal((await reviews.forPage()).statusOf('acme/shop#7').state, 'needs you');
});

test('a reviewer that gave a verdict and then asks you something says it needs you', async () => {
  const summaries = {};
  const { reviews } = setup({ live: (path) => (path.endsWith('-review-7') ? [{ sessionId: SESSION, needsYou: true }] : []), summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  summaries[SESSION] = '**Verdict:** `Approve`';
  const status = (await reviews.forPage()).statusOf('acme/shop#7');
  assert.equal(status.state, 'needs you');
  assert.equal(status.verdict, 'approve', 'the verdict it gave is kept');
});

test('one review per PR at a time; Review again reuses the checkout, moved to the PR\'s new head', async () => {
  let live = [SESSION];
  const { reviews, main, root, tick } = setup({ live: (path) => (path.endsWith('-review-7') ? live.map((sessionId) => ({ sessionId })) : []) });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /already running/.test(error.message));
  // Just started, before its session shows: still one at a time.
  live = [];
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409);
  tick(3 * 60_000);

  // A new commit on the PR.
  const work = join(root, 'work');
  git(work, 'checkout', '-q', 'fix-totals');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'more');
  const newHead = git(work, 'rev-parse', 'HEAD');
  git(join(root, 'origin.git'), 'fetch', '-q', work, `+fix-totals:refs/pull/7/head`);

  const again = await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.equal(again.sessionId, SESSION_2);
  assert.equal(again.path, `${main}-review-7`);
  assert.equal(git(again.path, 'rev-parse', 'HEAD'), newHead);
  assert.equal((await reviews.forPage()).statusOf('acme/shop#7').headSha, newHead);
});

test('Review needs the repo cloned here, an open PR, and a free folder', async () => {
  const closed = setup({ pr: { ...PR, state: 'MERGED' } });
  await assert.rejects(closed.reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /merged/i.test(error.message));
  await assert.rejects(closed.reviews.start({ repo: 'acme/elsewhere', number: 7 }), (error) => error.status === 404 && /clone/i.test(error.message));
  await assert.rejects(closed.reviews.start({ repo: 'not a repo', number: 7 }), (error) => error.status === 400);

  const taken = setup();
  mkdirSync(`${taken.main}-review-7`);
  await assert.rejects(taken.reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /already/.test(error.message));
});

test('a branch name gh gives that git would read as an option is refused', async () => {
  const { reviews } = setup({ pr: { ...PR, baseRefName: '--upload-pack=evil' } });
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 502);
});

test('Discard ends a running reviewer and removes its checkout and instructions', async () => {
  const { reviews, main, ended, dir } = setup({ live: (path) => (path.endsWith('-review-7') ? [{ sessionId: SESSION }] : []) });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  const path = `${main}-review-7`;
  assert.deepEqual(await reviews.discard({ repo: 'acme/shop', number: 7 }), { removed: path });
  assert.deepEqual(ended, [{ sessionId: SESSION }]);
  assert.ok(!existsSync(path));
  assert.ok(!git(main, 'worktree', 'list').includes('-review-7'));
  assert.ok(!existsSync(join(dir, 'pr-reviews', 'acme__shop-7.md')));
  assert.equal((await reviews.forPage()).statusOf('acme/shop#7'), null);
  await assert.rejects(reviews.discard({ repo: 'acme/shop', number: 7 }), (error) => error.status === 404);
});

test('Discard leaves a checkout with changes in it, and says so', async () => {
  const { reviews, main } = setup();
  await reviews.start({ repo: 'acme/shop', number: 7 });
  writeFileSync(join(`${main}-review-7`, 'notes.txt'), 'mine\n');
  await assert.rejects(reviews.discard({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /changes/.test(error.message));
  assert.ok(existsSync(`${main}-review-7`));
  assert.notEqual((await reviews.forPage()).statusOf('acme/shop#7'), null);
});

test('the sweep discards reviews of PRs that were merged or closed, and keeps open ones', async () => {
  const states = {};
  const { reviews, main } = setup({ states });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.deepEqual(await reviews.sweep(), { removed: [], errors: [] });
  assert.ok(existsSync(`${main}-review-7`));
  states['acme/shop#7'] = 'MERGED';
  assert.deepEqual(await reviews.sweep(), { removed: [`${main}-review-7`], errors: [] });
  assert.ok(!existsSync(`${main}-review-7`));
  assert.equal(reviews.any(), false);
});

/** Another PR in the world's origin: a commit of its own at refs/pull/<number>/head; gives its sha. */
function addPr(root, number) {
  const work = join(root, 'work');
  git(work, 'checkout', '-q', '-B', `pr-${number}`, 'main');
  writeFileSync(join(work, `pr-${number}.js`), `export const n = ${number};\n`);
  git(work, 'add', '.');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `pr ${number}`);
  git(join(root, 'origin.git'), 'fetch', '-q', work, `+pr-${number}:refs/pull/${number}/head`);
  return git(work, 'rev-parse', 'HEAD');
}

test('Reviews of several PRs in one repo started at once each check out their own PR, not one another\'s', async () => {
  const w = setup();
  const heads = { 7: w.head, 8: addPr(w.root, 8), 9: addPr(w.root, 9) };
  // The PRs are added after setup's world is built, so gh's answers for them are added now too.
  Object.assign(w.others, { 8: { ...PR, number: 8, headRefOid: heads[8] }, 9: { ...PR, number: 9, headRefOid: heads[9] } });
  const started = await Promise.all([7, 8, 9].map((number) => w.reviews.start({ repo: 'acme/shop', number })));
  for (const [i, number] of [7, 8, 9].entries()) {
    assert.equal(git(started[i].path, 'rev-parse', 'HEAD'), heads[number], `#${number}`);
  }
});

test('the checkout is the commit GitHub says is the PR\'s head; a push in between is refused, not reviewed blind', async () => {
  const { reviews, main } = setup({ pr: { ...PR, headRefOid: 'f'.repeat(40) } });
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /just changed/.test(error.message));
  assert.ok(!existsSync(`${main}-review-7`), 'nothing checked out');
});

test('the PR\'s head is fetched into a ref of its own, which Discard deletes', async () => {
  const { reviews, main } = setup();
  await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.match(git(main, 'rev-parse', 'refs/switchyard/pr-review/7'), /^[0-9a-f]{40}$/);
  await reviews.discard({ repo: 'acme/shop', number: 7 });
  assert.throws(() => git(main, 'rev-parse', '--verify', '--quiet', 'refs/switchyard/pr-review/7'));
});

const isGone = (main, path) => !existsSync(path) && !git(main, 'worktree', 'list').includes(path);

test('a Review that fails to start leaves nothing behind, so Review works again once the fault is fixed', async () => {
  const broken = { tmux: true };
  const { reviews, main } = setup({ broken });
  const path = `${main}-review-7`;
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 500 && /no server running/.test(error.message));
  assert.ok(isGone(main, path), 'no checkout');
  assert.equal((await reviews.forPage()).statusOf('acme/shop#7'), null, 'no review kept');
  assert.throws(() => git(main, 'rev-parse', '--verify', '--quiet', 'refs/switchyard/pr-review/7'));

  broken.tmux = false;
  assert.equal((await reviews.start({ repo: 'acme/shop', number: 7 })).path, path);
});

test('a Review again that fails to start keeps the review that was there', async () => {
  const broken = {};
  const summaries = {};
  const { reviews, main, tick } = setup({ broken, summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  summaries[SESSION] = '**Verdict:** `Approve`';
  tick(3 * 60_000);
  broken.tmux = true;
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 500);
  const kept = (await reviews.forPage()).statusOf('acme/shop#7');
  assert.equal(kept.sessionId, SESSION);
  assert.equal(kept.state, 'approve');
  assert.ok(existsSync(`${main}-review-7`), 'its checkout stays');
});

test('two Reviews of one PR asked at once start one reviewer', async () => {
  const summaries = {};
  const { reviews, typed, tick } = setup({ summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  summaries[SESSION] = '**Verdict:** `Approve`';
  tick(3 * 60_000);
  const windowsBefore = typed.filter(([kind]) => kind === 'window').length;
  const results = await Promise.allSettled([1, 2].map(() => reviews.start({ repo: 'acme/shop', number: 7 })));
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal(typed.filter(([kind]) => kind === 'window').length, windowsBefore + 1);
});

test('Review again ends the last reviewer if it\'s still open, done with its review; a busy one is waited for', async () => {
  const summaries = {};
  let live = [];
  const { reviews, ended, tick } = setup({ live: (path) => (path.endsWith('-review-7') ? live : []), summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  summaries[SESSION] = '**Verdict:** `Approve`';
  tick(3 * 60_000);

  live = [{ sessionId: SESSION, status: 'busy' }];
  await assert.rejects(reviews.start({ repo: 'acme/shop', number: 7 }), (error) => error.status === 409 && /already running/.test(error.message));
  assert.deepEqual(ended, []);

  live = [{ sessionId: SESSION, status: 'idle' }];
  const again = await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.deepEqual(ended, [{ sessionId: SESSION }]);
  assert.equal(again.sessionId, SESSION_2);
});

test('Review again puts back a checkout that was deleted by hand', async () => {
  const summaries = {};
  const { reviews, main, head, tick } = setup({ summaries });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  summaries[SESSION] = '**Verdict:** `Approve`';
  tick(3 * 60_000);
  rmSync(`${main}-review-7`, { recursive: true });
  const again = await reviews.start({ repo: 'acme/shop', number: 7 });
  assert.equal(git(again.path, 'rev-parse', 'HEAD'), head);
});

test('Discard removes the checkout of a repo that\'s no longer in your folders', async () => {
  const listed = { repo: true };
  const { reviews, main } = setup({ listed });
  await reviews.start({ repo: 'acme/shop', number: 7 });
  listed.repo = false;
  assert.deepEqual(await reviews.discard({ repo: 'acme/shop', number: 7 }), { removed: `${main}-review-7` });
  assert.ok(isGone(main, `${main}-review-7`));
});
