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

function setup(tasks = [task()], { fail = false } = {}) {
  const calls = [];
  const starter = createHubStarter({
    taskHub: { list: async () => tasks },
    newTask: {
      startTask: async (body) => {
        calls.push(body);
        if (fail) throw Object.assign(new Error('worktree exists'), { status: 409 });
        return { path: '/code/shop-x', branch: body.branch, session: 'switchyard', window: 'shop-x' };
      },
    },
    rediscover: async () => { calls.push('rediscover'); },
  });
  return { starter, calls };
}

test('start runs New task in the repo you chose, with the task\'s branch and prompt', async () => {
  const { starter, calls } = setup();
  const result = await starter.start({ id: 'sy-k3x9q2', repo: '/code/shop' });
  assert.deepEqual(calls, [
    { repo: '/code/shop', branch: 'sy-k3x9q2-email-receipt-after-each-charge', prompt: 'Email a receipt after each charge' },
    // So the new worktree shows under the task now, not when the repo list next refreshes.
    'rediscover',
  ]);
  assert.equal(result.window, 'shop-x');
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
