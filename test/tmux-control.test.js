import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { attachControlClient, createLineSplitter, decodeOutput, hexKeys, parseControlLine } from '../src/tmux-control.js';

const bytes = (text) => Buffer.from(text, 'utf8');

test('decodeOutput turns \\ooo escapes back into bytes and leaves UTF-8 alone', () => {
  assert.deepEqual(decodeOutput(bytes('\\033[31mred\\033[0m é\\015\\012')), bytes('\x1b[31mred\x1b[0m é\r\n'));
  assert.deepEqual(decodeOutput(bytes('a\\134b')), bytes('a\\b'));
});

test('decodeOutput keeps a backslash that is not followed by three octal digits', () => {
  assert.deepEqual(decodeOutput(bytes('\\9x\\01')), bytes('\\9x\\01'));
});

test('parseControlLine reads pane output, in both the plain and flow-controlled forms', () => {
  assert.deepEqual(parseControlLine(bytes('%output %3 hi\\015')), { type: 'output', pane: '%3', data: bytes('hi\r') });
  assert.deepEqual(parseControlLine(bytes('%extended-output %3 1234 : ok')), { type: 'output', pane: '%3', data: bytes('ok') });
});

test('parseControlLine reads subscription changes', () => {
  assert.deepEqual(parseControlLine(bytes('%subscription-changed size $0 @0 0 %0 : 120x40')), { type: 'subscription', name: 'size', pane: '%0', value: '120x40' });
});

test('parseControlLine reads pane flow-control, command replies and exit', () => {
  assert.deepEqual(parseControlLine(bytes('%pause %3')), { type: 'pause', pane: '%3' });
  assert.deepEqual(parseControlLine(bytes('%continue %3')), { type: 'continue', pane: '%3' });
  assert.equal(parseControlLine(bytes('%begin 1793993415 316 0')).type, 'begin');
  assert.equal(parseControlLine(bytes('%error 1793993415 316 0')).type, 'error');
  assert.equal(parseControlLine(bytes('%exit')).type, 'exit');
  assert.deepEqual(parseControlLine(bytes('80x24')), { type: 'line', text: '80x24' });
});

test('createLineSplitter joins lines split across chunks', () => {
  const lines = [];
  const split = createLineSplitter((line) => lines.push(line.toString()));
  split(bytes('%output %1 a'));
  split(bytes('b\n%exit\n%out'));
  split(bytes('put %1 c\n'));
  assert.deepEqual(lines, ['%output %1 ab', '%exit', '%output %1 c']);
});

test('hexKeys spells bytes for send-keys -H', () => {
  assert.equal(hexKeys(bytes('\x1b[A')), '1b 5b 41');
  assert.equal(hexKeys(bytes('é')), 'c3 a9');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { written: [], ended: false });
  child.stdin.write = (text) => child.stdin.written.push(text);
  child.stdin.end = () => { child.stdin.ended = true; };
  child.kill = () => {};
  return child;
}

test('attachControlClient attaches to the exact session and reports parsed lines', () => {
  const child = fakeChild();
  let spawnedWith = null;
  const events = [];
  attachControlClient({ session: 'switchyard', onEvent: (e) => events.push(e), onClose: () => {}, spawnTmux: (args) => { spawnedWith = args; return child; } });
  child.stdout.emit('data', bytes('%output %2 hey\n'));
  assert.deepEqual(spawnedWith, ['-C', 'attach-session', '-t', '=switchyard']);
  assert.deepEqual(events, [{ type: 'output', pane: '%2', data: bytes('hey') }]);
});

test('attachControlClient writes one-line commands, detaches on close, and reports the close once', () => {
  const child = fakeChild();
  let closes = 0;
  const client = attachControlClient({ session: 's', onEvent: () => {}, onClose: () => { closes += 1; }, spawnTmux: () => child });
  client.command('send-keys -t %2 -H 61');
  assert.throws(() => client.command('a\nb'));
  client.close();
  child.emit('exit');
  child.emit('exit');
  client.command('ignored after close');
  assert.deepEqual(child.stdin.written, ['send-keys -t %2 -H 61\n']);
  assert.equal(child.stdin.ended, true);
  assert.equal(closes, 1);
});
