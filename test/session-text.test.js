import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerElsewhere, sessionDetail, sessionTitle } from '../public/session-text.js';

const live = (fields, transcript = {}) => ({ sessionId: 'abcdef12-0000', cwd: '/w/my-repo', status: 'idle', ...fields, transcript });

test('sessionTitle prefers a name you chose, then Claude\'s name or title', () => {
  assert.equal(sessionTitle(live({ name: 'Login bug', nameIsCustom: true }, { title: 'AI title' })), 'Login bug');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' }, { title: 'AI title' })), 'AI title');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' }, { agentName: 'renamed', title: 'AI title' })), 'renamed');
});

test('sessionTitle never shows the generated "<folder>-<hex>" name: your prompt stands in until Claude titles it', () => {
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' }, { lastPrompt: 'Fix the  login\nredirect' })), 'Fix the login redirect');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' })), 'New session');
  assert.equal(sessionTitle(live({ name: null }, { lastPrompt: '   ' })), 'New session');
});

test('sessionTitle cuts a long prompt to about a line, at a word', () => {
  const prompt = 'Refactor the pull request sync so that GitHub lookups are batched and retried with backoff when rate limited';
  const title = sessionTitle(live({}, { lastPrompt: prompt }));
  assert.ok(title.length <= 80, title);
  assert.ok(title.endsWith('…'));
  assert.ok(prompt.startsWith(title.slice(0, -1)));
  assert.ok(!title.slice(0, -1).endsWith(' '));
});

test('the detail line doesn\'t repeat a prompt that is already the title', () => {
  assert.equal(sessionDetail(live({}, { lastPrompt: 'Fix the login redirect' })), null);
  assert.deepEqual(sessionDetail(live({}, { title: 'Login redirect fix', lastPrompt: 'Fix the login redirect' })),
    { kind: 'prompt', label: 'You', text: 'Fix the login redirect' });
});

test('a session that needs you says so, with the question when the transcript has it', () => {
  assert.deepEqual(sessionDetail(live({ needsYou: true }, { lastReply: 'old reply' })),
    { kind: 'needs-you', label: 'Needs you', text: 'Waiting for your answer or approval' });
  assert.equal(sessionDetail(live({ needsYou: true }, { activity: 'Asking: Which branch?' })).text, 'Asking: Which branch?');
});

test('a working session never shows the previous turn\'s reply', () => {
  assert.deepEqual(sessionDetail(live({ status: 'busy' }, { lastReply: 'previous turn' })),
    { kind: 'activity', label: null, text: 'Thinking…' });
  assert.equal(sessionDetail(live({ status: 'busy' }, { activity: 'Editing a.js', lastReply: 'x' })).text, 'Editing a.js');
  assert.equal(sessionDetail(live({ status: 'busy', inBackground: true }, { lastReply: 'x' })).text, 'Waiting for a background command');
});

test('waiting and ended sessions show the last reply, or how an interrupted one was cut off', () => {
  assert.equal(sessionDetail(live({}, { lastReply: 'Done.' })).text, 'Done.');
  assert.deepEqual(sessionDetail({ sessionId: 'x', endState: 'interrupted', transcript: { activity: 'Reading a.js' } }),
    { kind: 'cut-off', label: 'Cut off while', text: 'Reading a.js' });
  assert.deepEqual(sessionDetail({ sessionId: 'x', transcript: { title: 'Greeting', lastPrompt: 'hi' } }), { kind: 'prompt', label: 'You', text: 'hi' });
});

test('a waiting session whose dialog was read off its screen shows the question and options, and the dialog when opened', () => {
  const screenPrompt = {
    question: 'Which color do you prefer?',
    options: [{ number: 1, label: 'Red', selected: true }, { number: 2, label: 'Blue', selected: false }],
    text: 'Which color do you prefer?\n❯ 1. Red\n  2. Blue',
  };
  assert.deepEqual(sessionDetail(live({ needsYou: true, screenPrompt }, { activity: 'Asking: colors' })), {
    kind: 'needs-you', label: 'Asks', text: 'Which color do you prefer? 1. Red · 2. Blue', full: screenPrompt.text,
  });
  assert.equal(sessionDetail(live({ needsYou: true, screenPrompt: { ...screenPrompt, question: null } })).text, '1. Red · 2. Blue');
});

test("a session waiting where switchyard can't answer says where to answer it, and how to answer from here", () => {
  const waiting = (host) => ({ needsYou: true, host });
  assert.equal(answerElsewhere(waiting({ kind: 'editor', label: 'VS Code' }), []),
    'Answer it in VS Code. To answer from here, run Claude in tmux or start it with New task.');
  assert.match(answerElsewhere(waiting({ kind: 'terminal', label: 'Terminal', app: 'Terminal' }), []), /^Answer it in Terminal\./);
  assert.match(answerElsewhere(waiting(null), []), /^Answer it in its terminal\./);
});

test('no hint where the page can already answer: tmux, iTerm, or a prompt the hook sent', () => {
  assert.equal(answerElsewhere({ needsYou: true, host: { kind: 'tmux' } }, []), null);
  assert.equal(answerElsewhere({ needsYou: true, host: { kind: 'terminal', label: 'iTerm', app: 'iTerm' } }, []), null);
  assert.equal(answerElsewhere({ needsYou: true, host: { kind: 'editor', label: 'VS Code' } }, [{ id: 'a' }]), null);
  assert.equal(answerElsewhere({ needsYou: false, host: { kind: 'editor', label: 'VS Code' } }, []), null);
});
