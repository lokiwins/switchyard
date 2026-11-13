import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextSize, estimateTokens } from '../src/agents/context-tokens.js';

test('text is about 4 characters a token, rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens(null), 0);
});

test('content parts add up: text by length, images a fixed amount, others as JSON', () => {
  assert.equal(estimateTokens([{ type: 'text', text: 'x'.repeat(40) }, { type: 'image', source: {} }]), 10 + 1600);
  assert.equal(estimateTokens({ file_path: '/a' }), Math.ceil('{"file_path":"/a"}'.length / 4));
});

test('context size is all the input a call read, cached or not', () => {
  assert.equal(contextSize({ input_tokens: 4, cache_read_input_tokens: 300, cache_creation_input_tokens: 11, output_tokens: 99 }), 315);
  assert.equal(contextSize({ input_tokens: 4 }), 4);
  assert.equal(contextSize(undefined), null);
});
