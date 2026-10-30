import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionDetail, sessionTitle } from '../public/session-text.js';

const live = (fields, transcript = {}) => ({ sessionId: 'abcdef12-0000', cwd: '/w/my-repo', status: 'idle', ...fields, transcript });

test('sessionTitle prefers a name you chose, then the AI title, then the registry name', () => {
  assert.equal(sessionTitle(live({ name: 'my-repo-3f', nameIsCustom: true }, { title: 'AI title' })), 'my-repo-3f');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' }, { title: 'AI title' })), 'AI title');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' }, { agentName: 'renamed', title: 'AI title' })), 'renamed');
  assert.equal(sessionTitle(live({ name: 'my-repo-3f' })), 'my-repo-3f');
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
  assert.deepEqual(sessionDetail({ sessionId: 'x', transcript: { lastPrompt: 'hi' } }), { kind: 'prompt', label: 'You', text: 'hi' });
});
