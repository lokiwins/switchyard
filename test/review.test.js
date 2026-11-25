import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  REVIEWER_SETTINGS, createReviews, parseVerdict, reviewPrompt, withReviews,
} from '../src/review.js';

const SESSION = '0b6f1c2e-4a8d-4c1e-9f3a-2d5e6f7a8b9c';

test('the verdict is read from the start of the reviewer\'s last reply', () => {
  assert.equal(parseVerdict('VERDICT: PASS. Tests cover the rounding.'), 'passed');
  assert.equal(parseVerdict('Verdict: changes — the totals skip tax.'), 'changes');
  assert.equal(parseVerdict('  VERDICT: CHANGES\nmore'), 'changes');
  for (const text of [null, '', 'Looks good to me', 'I will start with VERDICT: PASS later']) assert.equal(parseVerdict(text), null, String(text));
});

test('the review prompt gives the criteria: the task, its notes, its checks, and what to compare with', () => {
  const prompt = reviewPrompt({
    task: { title: 'Fix the totals', notes: 'Round half up.\nKeep the API.' },
    branch: 'sy-wrk001-totals',
    base: 'sy-lead01-build',
    checks: [{ name: 'test', state: 'failed', outOfDate: false }, { name: 'lint', state: 'passed', outOfDate: true }],
  });
  assert.ok(!prompt.includes('\n'), 'one line, as New task types it');
  for (const part of ['Fix the totals', 'Round half up. Keep the API.', 'sy-wrk001-totals', 'git diff sy-lead01-build...HEAD', 'test failed', 'lint passed (out of date)', 'VERDICT: PASS', 'VERDICT: CHANGES', 'Don\'t change']) {
    assert.ok(prompt.includes(part), part);
  }
});

test('a title or notes ending in a full stop get just one', () => {
  const prompt = reviewPrompt({ task: { title: 'Fix it.', notes: 'Server-side.' }, branch: 'b', base: 'main', checks: [] });
  assert.ok(prompt.includes('task: Fix it. Notes: Server-side. See'), prompt);
});

test('long notes are cut to fit, rather than the review refused', () => {
  const prompt = reviewPrompt({ task: { title: 'T', notes: 'x'.repeat(5000) }, branch: 'b', base: 'main', checks: [] });
  assert.ok(prompt.length <= 2000, String(prompt.length));
  assert.ok(prompt.includes('VERDICT: CHANGES'));
});

test('the reviewer may read and look at git history, never edit', () => {
  assert.deepEqual(REVIEWER_SETTINGS.permissions.deny, ['Edit', 'Write', 'NotebookEdit', 'Bash(git * --output*)', 'Bash(git * --no-index*)']);
  for (const rule of ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)']) assert.ok(REVIEWER_SETTINGS.permissions.allow.includes(rule), rule);
});

// A task with a worktree, a subtask of a parent with one in the same repo, and the services faked.
function setup({ live = [], summaries = {}, tasks, full = false, withHooks } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'switchyard-review-'));
  let all = tasks ?? [
    { id: 'sy-lead01', title: 'Build receipts', notes: '', links: [], closedAs: null },
    { id: 'sy-wrk001', title: 'Fix the totals', notes: 'Round half up.', links: [], parentId: 'sy-lead01', closedAs: null },
  ];
  const repos = [{
    name: 'shop', mainPath: '/code/shop', worktrees: [
      { path: '/code/shop', branch: 'main', isMain: true },
      { path: '/code/shop-lead', branch: 'sy-lead01-build', isMain: false, agents: { live: [], recent: [] } },
      { path: '/code/shop-tests', branch: 'sy-wrk001-totals', isMain: false, agents: { live, recent: [] } },
    ],
  }];
  const typed = [];
  const taskHub = {
    list: async () => all,
    noteReview: async (id, review) => { all = all.map((t) => (t.id === id ? { ...t, reviews: [review] } : t)); return review; },
  };
  const tmux = {
    hasWindow: async () => false,
    newWindow: async (options) => { typed.push(['window', options]); return { window: '@9', pane: '%9' }; },
    sendLine: async (pane, text) => typed.push(['type', pane, text]),
    killWindow: async () => {},
  };
  const tracked = [];
  const provider = {
    label: 'Claude Code', takesLaunchOptions: true, command: 'claude',
    launchCommand: (prompt, options) => JSON.stringify({ prompt, ...options }),
  };
  const reviews = createReviews({
    taskHub, tmux, provider: () => provider, getRepos: async () => repos,
    checkResults: async () => ({ '/code/shop-tests': [{ name: 'test', state: 'failed', outOfDate: false }] }),
    readSession: async (cwd, sessionId) => summaries[`${cwd} ${sessionId}`] ?? null,
    defaultBranch: async () => 'origin/main',
    dir,
    newSessionId: () => SESSION,
    now: () => 1000,
    starts: { track: (start) => tracked.push(start) },
    limit: { check: async () => { if (full) throw Object.assign(new Error('3 agents are running'), { status: 409 }); } },
    ...(withHooks ? { withHooks } : {}),
  });
  return { reviews, typed, dir, tracked, getTasks: () => all };
}

test('Review starts a reviewer in the worktree: its own window, a known session id, read-only settings, and the criteria', async () => {
  const { reviews, typed, dir, getTasks } = setup();
  const started = await reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' });
  assert.deepEqual(started, { sessionId: SESSION, window: 'review-shop-tests' });
  const [, window] = typed.find((t) => t[0] === 'window');
  assert.equal(window.cwd, '/code/shop-tests');
  assert.equal(window.name, 'review-shop-tests');
  const command = JSON.parse(typed.find((t) => t[0] === 'type')[2]);
  assert.equal(command.permissionMode, 'manual');
  assert.equal(command.sessionId, SESSION);
  assert.equal(command.name, 'Review · Fix the totals');
  assert.equal(command.settings, join(dir, 'reviewer.settings.json'));
  assert.deepEqual(JSON.parse(readFileSync(command.settings, 'utf8')), REVIEWER_SETTINGS);
  assert.equal(statSync(command.settings).mode & 0o777, 0o600);
  // A subtask is compared with its parent's branch in that repo; its checks are in the criteria.
  assert.ok(command.prompt.includes('git diff sy-lead01-build...HEAD'));
  assert.ok(command.prompt.includes('test failed'));
  assert.deepEqual(getTasks().find((t) => t.id === 'sy-wrk001').reviews, [{ path: '/code/shop-tests', sessionId: SESSION, startedAt: 1000 }]);
});

test('a task with no parent is compared with the repo\'s default branch', async () => {
  const { reviews, typed } = setup();
  await reviews.start({ id: 'sy-lead01', path: '/code/shop-lead' });
  assert.ok(JSON.parse(typed.find((t) => t[0] === 'type')[2]).prompt.includes('git diff origin/main...HEAD'));
});

test('Review refuses a folder that isn\'t the task\'s, a closed task, and a second review while one runs there', async () => {
  const { reviews } = setup();
  await assert.rejects(reviews.start({ id: 'sy-wrk001', path: '/code/shop-lead' }), (error) => error.status === 404);
  await assert.rejects(reviews.start({ id: 'sy-wrk001', path: '/code/shop' }), (error) => error.status === 404);
  await assert.rejects(reviews.start({ id: 'sy-nope00', path: '/code/shop-tests' }), (error) => error.status === 404);
  const closed = setup({ tasks: [{ id: 'sy-wrk001', title: 'T', notes: '', links: [], closedAs: 'done' }] });
  await assert.rejects(closed.reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' }), (error) => error.status === 409);
  const running = setup({ live: [{ sessionId: SESSION, status: 'busy' }] });
  await running.reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' });
  await assert.rejects(running.reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' }), (error) => error.status === 409 && /already/.test(error.message));
});

test('a review\'s state: reviewing while its session runs without a verdict; then passed, changes, or no verdict', async () => {
  // Started long before setup's clock (1000), so it's past starting.
  const review = { path: '/code/shop-tests', sessionId: SESSION, startedAt: -10 * 60_000 };
  const statusOf = async (live, lastReply) => {
    const { reviews } = setup({ summaries: lastReply === undefined ? {} : { [`/code/shop-tests ${SESSION}`]: { lastReply } } });
    return reviews.status(review, live ? [{ sessionId: SESSION, status: 'busy' }] : []);
  };
  assert.equal((await statusOf(true, undefined)).state, 'reviewing');
  assert.equal((await statusOf(true, 'Reading the diff…')).state, 'reviewing');
  assert.deepEqual(await statusOf(false, 'VERDICT: PASS. Covered.'), {
    path: '/code/shop-tests', sessionId: SESSION, startedAt: -10 * 60_000, live: false, state: 'passed', summary: 'VERDICT: PASS. Covered.',
  });
  assert.equal((await statusOf(true, 'VERDICT: CHANGES. Tax is skipped.')).state, 'changes');
  assert.equal((await statusOf(false, 'I could not finish.')).state, 'no verdict');
  assert.equal((await statusOf(false, 'I could not finish.')).state, 'no verdict');
});

test('each worktree line gets its latest review, and the reviewer\'s session isn\'t taken for the work\'s own', () => {
  const tasks = [{
    id: 'sy-wrk001',
    work: [{ path: '/code/shop-tests', live: [{ sessionId: 'worker' }, { sessionId: SESSION }], recent: [{ sessionId: SESSION }] }],
  }];
  const statuses = { 'sy-wrk001': [{ path: '/code/shop-tests', sessionId: SESSION, state: 'reviewing' }] };
  const [task] = withReviews(tasks, statuses);
  assert.deepEqual(task.work[0].live, [{ sessionId: 'worker' }]);
  assert.deepEqual(task.work[0].recent, []);
  assert.equal(task.work[0].review.state, 'reviewing');
  assert.equal(task.work[0].review.session.sessionId, SESSION, 'the running reviewer, for its controls');
});

test('a review just started, before its session shows up, is reviewing, not without a verdict', async () => {
  const { reviews } = setup();
  const review = { path: '/code/shop-tests', sessionId: SESSION, startedAt: 1000 };
  // setup's clock says 1000: started just now, no session or transcript yet.
  assert.equal((await reviews.status(review, [])).state, 'reviewing');
  assert.equal((await reviews.status({ ...review, startedAt: 1000 - 3 * 60_000 }, [])).state, 'no verdict');
});

test('the reviewer\'s pane is watched as it starts, so a folder Claude asks to trust asks on the task\'s row', async () => {
  const { reviews, tracked } = setup();
  await reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' });
  assert.deepEqual(tracked, [{ path: '/code/shop-tests', place: 'switchyard:review-shop-tests', pane: '%9', command: 'claude' }]);
});

test('a reviewer showing a prompt needs you, until it has a verdict', async () => {
  const { reviews } = setup();
  const review = { path: '/code/shop-tests', sessionId: SESSION, startedAt: -10 * 60_000 };
  assert.equal((await reviews.status(review, [{ sessionId: SESSION, status: 'idle', needsYou: true }])).state, 'needs you');
});

test('the review reads with more of the plain read-only commands allowed, so it asks you less', () => {
  for (const rule of ['Bash(cat:*)', 'Bash(ls:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)']) assert.ok(REVIEWER_SETTINGS.permissions.allow.includes(rule), rule);
});

test('over the running-agents limit, a review isn\'t started', async () => {
  const { reviews, typed, getTasks } = setup({ full: true });
  await assert.rejects(reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' }), (error) => error.status === 409);
  assert.deepEqual(typed, []);
  assert.equal(getTasks().find((t) => t.id === 'sy-wrk001').reviews, undefined);
});

test('a reviewer\'s settings carry switchyard\'s session event hooks too', async () => {
  const { reviews, typed } = setup({ withHooks: (settings) => ({ ...settings, hooks: { Stop: ['switchyard'] } }) });
  await reviews.start({ id: 'sy-wrk001', path: '/code/shop-tests' });
  const command = JSON.parse(typed.find((t) => t[0] === 'type')[2]);
  assert.deepEqual(JSON.parse(readFileSync(command.settings, 'utf8')), { ...REVIEWER_SETTINGS, hooks: { Stop: ['switchyard'] } });
});
