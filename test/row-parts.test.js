import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveRowParts, prCardParts } from '../public/row-parts.js';

const sigs = (parts) => Object.fromEntries(parts.map((p) => [p.key, p.sig]));
const changed = (before, after) => Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();

/* ---------- a live session's row on the Agents page ---------- */

const SESSION = {
  sessionId: 's1', pid: 101, cwd: '/code/billing-api-fix', status: 'busy', statusUpdatedAt: 1000, parked: false, needsYou: false,
  host: { kind: 'tmux', label: 'tmux', session: 'switchyard', window: 2 }, screenPrompt: null, hubTask: null,
  transcript: { title: 'Fix the totals', activity: 'Reading src/cart.js', lastReply: null },
};
const WHERE = { repo: { name: 'billing-api' }, worktree: { branch: 'fix-totals', pr: { url: 'https://example.test/pr/7', number: 7 }, task: null } };
const live = (session = SESSION, { where = WHERE, approvals = [], detailOpen = false } = {}) => sigs(liveRowParts(session, { where, approvals, detailOpen }));

test('a live row is its parts, in order: state, who and where, detail, time, buttons', () => {
  assert.deepEqual(liveRowParts(SESSION, { where: WHERE, approvals: [], detailOpen: false }).map((p) => p.key), ['badge', 'who', 'detail', 'time', 'actions']);
});

test('nothing changed: every part is the same', () => {
  assert.deepEqual(changed(live(), live(structuredClone(SESSION))), []);
});

test('a working session\'s activity redraws only its detail line, not its buttons with their open menus', () => {
  const next = { ...SESSION, transcript: { ...SESSION.transcript, activity: 'Running npm test' } };
  assert.deepEqual(changed(live(), live(next)), ['detail']);
});

test('a new title redraws the who part only', () => {
  const next = { ...SESSION, transcript: { ...SESSION.transcript, title: 'Fix the invoice totals' } };
  assert.deepEqual(changed(live(), live(next)), ['who']);
});

test('the turn ending changes what the row offers: state, detail, time and buttons', () => {
  const idle = { ...SESSION, status: 'idle', statusUpdatedAt: 2000, transcript: { ...SESSION.transcript, activity: null, lastReply: 'Done.' } };
  assert.deepEqual(changed(live(), live(idle)), ['actions', 'badge', 'detail', 'time']);
});

test('a question from this session redraws its detail and buttons; one from another session changes nothing', () => {
  assert.deepEqual(changed(live(), live(SESSION, { approvals: [{ id: 'a1', sessionId: 's1', toolName: 'Bash' }] })), ['actions', 'detail']);
  assert.deepEqual(changed(live(), live(SESSION, { approvals: [] })), []);
});

test('opening the detail redraws only the detail', () => {
  assert.deepEqual(changed(live(), live(SESSION, { detailOpen: true })), ['detail']);
});

test('its worktree\'s PR or branch: the buttons and the where line', () => {
  const where = { ...WHERE, worktree: { ...WHERE.worktree, pr: { url: 'https://example.test/pr/8', number: 8 } } };
  assert.deepEqual(changed(live(), live(SESSION, { where })), ['actions']);
  const moved = { ...WHERE, worktree: { ...WHERE.worktree, branch: 'other' } };
  assert.deepEqual(changed(live(), live(SESSION, { where: moved })), ['who']);
});

/* ---------- a PR card on the PRs page ---------- */

const PR = {
  repo: 'acme/billing-api', number: 7, title: 'Fix totals', url: 'https://example.test/pr/7', stage: 'awaiting-review',
  headRefName: 'fix-totals', baseRefName: 'main', author: { login: 'someone' }, updatedAt: '2026-11-19T10:00:00Z', fetchedAt: 1000,
  additions: 3, deletions: 1, changedFiles: 1,
  checks: { total: 2, passing: 2, failing: 0, pending: 0, failed: [], running: [], heldCount: 0, held: [] },
  reviews: [], requested: [{ name: 'reviewer', isTeam: false }],
  local: { path: '/code/billing-api-fix', dirty: false, agents: [], sessions: [] },
  copilot: null,
};
const OPTS = { showAuthor: false, canAskCopilot: true, caps: { terminal: true } };
const pr = (data = PR, opts = OPTS) => sigs(prCardParts(data, opts));

test('a PR card is its parts: title line, meta, checks, reviews, local copy, Copilot', () => {
  assert.deepEqual(prCardParts(PR, OPTS).map((p) => p.key), ['line', 'meta', 'checks', 'reviews', 'local', 'side']);
  assert.deepEqual(prCardParts({ ...PR, error: 'timed out' }, OPTS).map((p) => p.key), ['line', 'meta', 'error', 'side']);
});

test('GitHub being checked again (with nothing new) redraws only the meta line, not the Open ▾ menu', () => {
  assert.deepEqual(changed(pr(), pr({ ...PR, fetchedAt: 2000 })), ['meta']);
});

test('each change redraws only its own part', () => {
  assert.deepEqual(changed(pr(), pr({ ...PR, checks: { ...PR.checks, pending: 1, running: [{ name: 'ci' }] } })), ['checks']);
  assert.deepEqual(changed(pr(), pr({ ...PR, reviews: [{ login: 'r', state: 'APPROVED', submittedAt: '2026-11-19T11:00:00Z' }] })), ['reviews']);
  assert.deepEqual(changed(pr(), pr({ ...PR, local: { ...PR.local, dirty: true } })), ['local']);
  assert.deepEqual(changed(pr(), pr({ ...PR, stage: 'ready' })), ['line']);
  assert.deepEqual(changed(pr(), pr({ ...PR, copilot: { requested: true } })), ['side']);
  assert.deepEqual(changed(pr(), pr(PR, { ...OPTS, caps: { terminal: false } })), ['local']);
});
