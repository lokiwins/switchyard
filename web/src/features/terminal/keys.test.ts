import { expect, test } from 'vitest';
import { NEW_LINE, keyInput } from './keys';

const key = (fields: Partial<KeyboardEvent>) => ({ type: 'keydown', key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...fields });

test('Shift+Enter types a new line as Option+Enter does, which Claude Code takes as one rather than submitting', () => {
  expect(NEW_LINE).toBe('\x1b\r');
  expect(keyInput(key({ shiftKey: true }))).toStrictEqual({ send: NEW_LINE });
});

test('the browser\'s own keypress and keyup for it are swallowed, so it isn\'t also sent as Enter', () => {
  expect(keyInput(key({ type: 'keypress', shiftKey: true }))).toStrictEqual({ send: null });
  expect(keyInput(key({ type: 'keyup', shiftKey: true }))).toStrictEqual({ send: null });
});

test('every other key, Enter included, is left to the terminal', () => {
  for (const fields of [{}, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }, { shiftKey: true, altKey: true }, { key: 'a', shiftKey: true }]) {
    expect(keyInput(key(fields)), JSON.stringify(fields)).toBe(null);
  }
});

test('Shift+Enter while an input method is composing text is left to it', () => {
  expect(keyInput(key({ shiftKey: true, isComposing: true }))).toBe(null);
});
