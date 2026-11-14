import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canMakeTaskFrom, createTaskSources } from '../src/task-sources.js';
import { firstPrompt, transcriptDirName } from '../src/agents/claude-transcript.js';

const LIVE = '0b6c3c1e-8a52-4a8e-9a43-0c5c1f3e2d11';
const ON_MAIN = '1c7d4d2f-9b63-4b9f-8b54-1d6d2f4f3e22';
const ENDED = '2d8e5e3a-ac74-4caa-9c65-2e7e3a5a4f33';
const RECENT = '3e9f6f4b-bd85-4ddb-8d76-3f8f4b6b5a44';

const line = (entry) => `${JSON.stringify(entry)}\n`;
const human = (text) => line({ type: 'user', message: { role: 'user', content: text } });

function setup() {
  const claudeDir = mkdtempSync(join(tmpdir(), 'sy-sources-'));
  const transcript = (cwd, id, text) => {
    const dir = join(claudeDir, 'projects', transcriptDirName(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.jsonl`), text);
  };
  const state = {
    repos: [{
      name: 'shop',
      mainPath: '/code/shop',
      worktrees: [
        {
          path: '/code/shop-login', branch: 'fix-login', isMain: false,
          agents: { live: [{ sessionId: LIVE, cwd: '/code/shop-login/web', transcript: { title: 'Fix the login redirect' } }], last: null, recent: [{ sessionId: RECENT, transcript: { title: null } }] },
        },
        {
          path: '/code/shop', branch: 'main', isMain: true,
          agents: { live: [{ sessionId: ON_MAIN, cwd: '/code/shop', transcript: { title: 'Look into slow checkout' } }], last: { sessionId: ON_MAIN }, recent: [] },
        },
        { path: '/code/shop-quiet', branch: 'main-copy', isMain: false, agents: { live: [], last: null, recent: [] } },
        { path: '/code/shop-develop', branch: 'develop', isMain: false, agents: { live: [], last: null, recent: [] } },
      ],
    }],
    endedSessions: [{ sessionId: ENDED, cwd: '/code/shop-login', worktreePath: '/code/shop-login', repoName: 'shop', branch: 'fix-login', transcript: { title: 'Earlier try' } }],
  };
  const sources = createTaskSources({
    claudeDir,
    getState: async () => state,
    isLongLivedBranch: (branch) => ['main', 'develop'].includes(branch),
  });
  return { sources, transcript };
}

const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('firstPrompt is the first thing you asked, skipping meta lines, commands and tool results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sy-first-'));
  const file = join(dir, 's.jsonl');
  writeFileSync(file, [
    line({ type: 'summary' }),
    line({ type: 'user', isMeta: true, message: { content: 'Caveat: meta' } }),
    human('<command-name>/clear</command-name>'),
    human('Fix the login redirect\nIt loops on Safari.'),
    human('And add a test'),
  ].join(''));
  assert.equal(await firstPrompt(file), 'Fix the login redirect\nIt loops on Safari.');
  assert.equal(await firstPrompt(join(dir, 'missing.jsonl')), null);
});

test('a draft from a live session on a feature branch: its title, first prompt, and its repo and branch', async () => {
  const { sources, transcript } = setup();
  transcript('/code/shop-login/web', LIVE, human('Fix the login redirect, it loops on Safari'));
  const draft = await sources.draft({ sessionId: LIVE });
  assert.deepEqual(draft, {
    title: 'Fix the login redirect',
    notes: 'Fix the login redirect, it loops on Safari',
    where: { repoName: 'shop', branch: 'fix-login', sessionOnly: false },
  });
  assert.deepEqual(await sources.attach({ sessionId: LIVE }), [{ repo: '/code/shop', branch: 'fix-login' }]);
});

test('a session on a long-lived branch is saved by itself, so the task doesn\'t take in all of main', async () => {
  const { sources, transcript } = setup();
  transcript('/code/shop', ON_MAIN, human('Why is checkout slow?'));
  const draft = await sources.draft({ sessionId: ON_MAIN });
  assert.deepEqual(draft.where, { repoName: 'shop', branch: 'main', sessionOnly: true });
  assert.deepEqual(await sources.attach({ sessionId: ON_MAIN }), [{ sessionId: ON_MAIN }]);
});

test('ended and recent sessions are found too', async () => {
  const { sources, transcript } = setup();
  transcript('/code/shop-login', ENDED, human('First go at it'));
  assert.deepEqual(await sources.draft({ sessionId: ENDED }), {
    title: 'Earlier try', notes: 'First go at it', where: { repoName: 'shop', branch: 'fix-login', sessionOnly: false },
  });
  transcript('/code/shop-login', RECENT, human('Pick it up again\nwith more detail'));
  const recent = await sources.draft({ sessionId: RECENT });
  assert.equal(recent.title, 'Pick it up again', 'without a title, the first line of the first prompt');
});

test('a draft from a worktree: its branch, and its latest session\'s title and prompt', async () => {
  const { sources, transcript } = setup();
  transcript('/code/shop-login/web', LIVE, human('Fix the login redirect'));
  const draft = await sources.draft({ worktree: '/code/shop-login' });
  assert.equal(draft.title, 'Fix the login redirect');
  assert.deepEqual(await sources.attach({ worktree: '/code/shop-login' }), [{ repo: '/code/shop', branch: 'fix-login' }]);
  const quiet = await sources.draft({ worktree: '/code/shop-quiet' });
  assert.deepEqual(quiet, { title: 'main-copy', notes: '', where: { repoName: 'shop', branch: 'main-copy', sessionOnly: false } });
});

test('a worktree on a long-lived branch is saved by its latest session; with none, it can\'t be', async () => {
  const { sources } = setup();
  assert.deepEqual(await sources.attach({ worktree: '/code/shop' }), [{ sessionId: ON_MAIN }]);
  await rejectsWith(sources.draft({ worktree: '/code/shop-develop' }), 409, /develop/);
  await rejectsWith(sources.attach({ worktree: '/code/shop-develop' }), 409, /develop/);
});

test('unknown sessions and worktrees, and bad input, are refused', async () => {
  const { sources } = setup();
  await rejectsWith(sources.draft({ sessionId: '9999aaaa-2222-4333-8444-555555555555' }), 404);
  await rejectsWith(sources.draft({ sessionId: '../../etc' }), 400);
  await rejectsWith(sources.draft({ worktree: '/elsewhere' }), 404);
  await rejectsWith(sources.draft({}), 400);
  await rejectsWith(sources.draft(null), 400);
});

test('canMakeTaskFrom: a worktree on its own branch, or one on a long-lived branch with a session to save', () => {
  const longLived = (branch) => branch === 'main';
  const none = { live: [], last: null, recent: [] };
  assert.equal(canMakeTaskFrom({ branch: 'fix-login', agents: none }, longLived), true);
  assert.equal(canMakeTaskFrom({ branch: 'main', agents: none }, longLived), false);
  assert.equal(canMakeTaskFrom({ branch: 'main', agents: { ...none, last: { sessionId: ON_MAIN } } }, longLived), true);
  assert.equal(canMakeTaskFrom({ branch: null, agents: none }, longLived), false);
});
