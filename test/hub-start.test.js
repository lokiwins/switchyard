import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchForHubTask, createHubStarter, promptForHubTask } from '../src/hub-start.js';

const task = (overrides = {}) => ({
  id: 'sy-k3x9q2', title: 'Email a receipt after each charge', notes: '', links: [], closedAs: null, ...overrides,
});

test('a task starts on a branch named by its id and title', () => {
  assert.equal(branchForHubTask(task()), 'sy-k3x9q2-email-receipt-after-each-charge');
});

test('a task linking a ClickUp ticket starts on a CU-<id> branch, which ClickUp and the page both read', () => {
  assert.equal(branchForHubTask(task({ links: ['https://github.com/o/r/issues/1', 'https://app.clickup.com/t/86b4fx5'] })), 'CU-86b4fx5-email-receipt-after-each-charge');
  assert.equal(branchForHubTask(task({ links: ['https://app.clickup.com/t/9012345/ENG-123'] })), 'ENG-123-email-receipt-after-each-charge');
});

test('the prompt is the title, the notes on one line, then the ticket links', () => {
  assert.equal(promptForHubTask(task()), 'Email a receipt after each charge');
  assert.equal(
    promptForHubTask(task({ notes: 'Use the mailer.\n\nNo PDFs yet.', links: ['https://app.clickup.com/t/86b4fx5', 'https://github.com/o/r/issues/1'] })),
    'Email a receipt after each charge. Use the mailer. No PDFs yet. Tickets: https://app.clickup.com/t/86b4fx5 https://github.com/o/r/issues/1',
  );
});

test('a prompt too long for New task is refused, saying to shorten the notes', () => {
  assert.throws(() => promptForHubTask(task({ notes: 'x'.repeat(2000) })), (error) => error.status === 400 && /notes/.test(error.message));
});

const NOW = Date.UTC(2026, 10, 18, 12);

/** `failOn`: the attempts (1-based) whose start fails; `fail` makes every start fail. */
function setup(tasks = [task()], { fail = false, failOn = [] } = {}) {
  const calls = [];
  const recorded = [];
  let n = 0;
  const starter = createHubStarter({
    taskHub: { list: async () => tasks, recordAttempts: async (id, group) => { recorded.push([id, group]); } },
    newTask: {
      startTask: async (body) => {
        calls.push(body);
        n += 1;
        if (fail || failOn.includes(n)) throw Object.assign(new Error('worktree exists'), { status: 409 });
        const folder = `shop-${body.branch.split('-').pop()}`;
        return { path: `/code/${folder}`, branch: body.branch, session: 'switchyard', window: folder, provider: body.provider ?? 'claude' };
      },
    },
    rediscover: async () => { calls.push('rediscover'); },
    now: () => NOW,
  });
  return { starter, calls, recorded };
}

test('start runs New task in the repo you chose, with the task\'s branch and prompt', async () => {
  const { starter, calls } = setup();
  const result = await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop' });
  assert.deepEqual(calls, [
    { repo: '/code/shop', branch: 'sy-k3x9q2-email-receipt-after-each-charge', prompt: 'Email a receipt after each charge' },
    // So the new worktree shows under the task now, not when the repo list next refreshes.
    'rediscover',
  ]);
  assert.equal(result.window, 'shop-charge');
});

test('start refuses a task that is not there, or is closed', async () => {
  const { starter, calls } = setup([task({ closedAs: 'done' })]);
  await assert.rejects(starter.start({ id: 'sy-nope00', repo: '/code/shop' }), (error) => error.status === 404);
  await assert.rejects(starter.start({ id: 'sy-k3x9q2', repo: '/code/shop' }), (error) => error.status === 409 && /Reopen/.test(error.message));
  assert.equal(calls.length, 0);
});

test('a start that fails does not rescan', async () => {
  const { starter, calls } = setup([task()], { fail: true });
  await assert.rejects(starter.start({ id: 'sy-k3x9q2', repo: '/code/shop' }), (error) => error.status === 409);
  assert.equal(calls.includes('rediscover'), false);
});

const BRANCH = 'sy-k3x9q2-email-receipt-after-each-charge';
const PROMPT = 'Email a receipt after each charge';

test('start with attempts runs New task once per attempt, each on its own -try branch, with the same prompt', async () => {
  const { starter, calls, recorded } = setup();
  const result = await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts: 3 });
  assert.deepEqual(calls, [
    { repo: '/code/shop', branch: `${BRANCH}-try1`, prompt: PROMPT },
    { repo: '/code/shop', branch: `${BRANCH}-try2`, prompt: PROMPT },
    { repo: '/code/shop', branch: `${BRANCH}-try3`, prompt: PROMPT },
    'rediscover',
  ]);
  assert.deepEqual(result.attempts.map((a) => a.window), ['shop-try1', 'shop-try2', 'shop-try3']);
  assert.deepEqual(result.errors, []);
  // The task remembers the group, for comparing them later.
  assert.deepEqual(recorded, [['sy-k3x9q2', {
    provider: 'claude', repo: '/code/shop', branches: [`${BRANCH}-try1`, `${BRANCH}-try2`, `${BRANCH}-try3`], startedAt: NOW,
  }]]);
});

test('one attempt is a plain start: the task\'s own branch, nothing recorded', async () => {
  for (const attempts of [undefined, 1]) {
    const { starter, calls, recorded } = setup();
    await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts });
    assert.equal(calls[0].branch, BRANCH);
    assert.deepEqual(recorded, []);
  }
});

test('attempts are a whole number from 1 to 4, checked before anything starts', async () => {
  for (const attempts of [0, 5, 2.5, '2', -1, null]) {
    const { starter, calls } = setup();
    await assert.rejects(starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts }), (error) => error.status === 400 && /1 to 4/.test(error.message), String(attempts));
    assert.equal(calls.length, 0);
  }
});

test('an attempt that fails leaves the ones started running and says why; the group is what started', async () => {
  const { starter, calls, recorded } = setup([task()], { failOn: [2] });
  const result = await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts: 3 });
  assert.deepEqual(result.attempts.map((a) => a.branch), [`${BRANCH}-try1`, `${BRANCH}-try3`]);
  assert.match(result.errors.join(' '), /Attempt 2.*worktree exists/);
  assert.deepEqual(recorded[0][1].branches, [`${BRANCH}-try1`, `${BRANCH}-try3`]);
  assert.ok(calls.includes('rediscover'));
});

test('when every attempt fails, start fails, and nothing is recorded', async () => {
  const { starter, recorded } = setup([task()], { fail: true });
  await assert.rejects(starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts: 2 }), (error) => error.status === 409 && /worktree exists/.test(error.message));
  assert.deepEqual(recorded, []);
});

test('the agent asked for runs every attempt, and is the one recorded', async () => {
  const { starter, calls, recorded } = setup();
  await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop', attempts: 2, provider: 'other' });
  assert.deepEqual(calls.filter((c) => c !== 'rediscover').map((c) => c.provider), ['other', 'other']);
  assert.equal(recorded[0][1].provider, 'other');
});
