import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines } from '../src/diff.js';

const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');
const kinds = (hunk) => hunk.lines.map((l) => l.type).join('');

test('diffLines finds a changed line with three lines of context and real line numbers', () => {
  const before = lines(20);
  const after = before.replace('line 10', 'line ten');
  const { hunks, added, removed } = diffLines(before, after);
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(hunks.length, 1);
  assert.equal(kinds(hunks[0]), '   -+   ');
  assert.deepEqual(hunks[0].lines[3], { type: '-', text: 'line 10', old: 10, new: null });
  assert.deepEqual(hunks[0].lines[4], { type: '+', text: 'line ten', old: null, new: 10 });
  assert.deepEqual(hunks[0].lines[0], { type: ' ', text: 'line 7', old: 7, new: 7 });
});

test('diffLines splits changes far apart into separate hunks', () => {
  const before = lines(40);
  const after = before.replace('line 5', 'five').replace('line 35', 'thirty-five');
  assert.equal(diffLines(before, after).hunks.length, 2);
});

test('diffLines shows a new file as all additions', () => {
  const { hunks, added, removed } = diffLines('', 'a\nb');
  assert.equal(added, 2);
  assert.equal(removed, 0);
  assert.deepEqual(hunks[0].lines.map((l) => [l.type, l.text, l.new]), [['+', 'a', 1], ['+', 'b', 2]]);
});

test('diffLines reports no hunks for identical text', () => {
  assert.deepEqual(diffLines('same\ntext', 'same\ntext'), { hunks: [], added: 0, removed: 0, approximate: false });
});

test('diffLines keeps line numbers right after insertions and deletions', () => {
  const before = ['a', 'b', 'c', 'd', 'e'].join('\n');
  const after = ['a', 'x', 'y', 'b', 'c', 'e'].join('\n');
  const { hunks } = diffLines(before, after, { context: 0 });
  const flat = hunks.flatMap((h) => h.lines);
  assert.deepEqual(flat.find((l) => l.text === 'x'), { type: '+', text: 'x', old: null, new: 2 });
  assert.deepEqual(flat.find((l) => l.text === 'd'), { type: '-', text: 'd', old: 4, new: null });
});

test('diffLines falls back to replacing everything when the texts are too big to compare line by line', () => {
  const result = diffLines(lines(3000), lines(3000, 'row'), { maxCells: 1000 });
  assert.equal(result.approximate, true);
  assert.equal(result.removed, 3000);
  assert.equal(result.added, 3000);
});

test('diffLines treats CRLF like LF and ignores a final newline', () => {
  assert.equal(diffLines('a\r\nb\r\n', 'a\nb').hunks.length, 0);
});
