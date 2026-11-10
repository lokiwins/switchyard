import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEW_LINE, keyInput } from '../public/terminal-keys.js';

const key = (fields) => ({ type: 'keydown', key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...fields });

test('Shift+Enter types a new line as Option+Enter does, which Claude Code takes as one rather than submitting', () => {
  assert.equal(NEW_LINE, '\x1b\r');
  assert.deepEqual(keyInput(key({ shiftKey: true })), { send: NEW_LINE });
});

test('the browser\'s own keypress and keyup for it are swallowed, so it isn\'t also sent as Enter', () => {
  assert.deepEqual(keyInput(key({ type: 'keypress', shiftKey: true })), { send: null });
  assert.deepEqual(keyInput(key({ type: 'keyup', shiftKey: true })), { send: null });
});

test('every other key, Enter included, is left to the terminal', () => {
  for (const fields of [{}, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }, { shiftKey: true, altKey: true }, { key: 'a', shiftKey: true }]) {
    assert.equal(keyInput(key(fields)), null, JSON.stringify(fields));
  }
});

test('Shift+Enter while an input method is composing text is left to it', () => {
  assert.equal(keyInput(key({ shiftKey: true, isComposing: true })), null);
});
