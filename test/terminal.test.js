import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReadScreen, createTerminal } from '../src/terminal.js';

function fakeOsascript(output = '') {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return output;
  };
  return { exec, calls };
}

const iterm = (exec) => createTerminal({ app: 'iTerm', platform: 'darwin', exec });
const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test("screen reads an iTerm tab's text by its tty, and null when no tab has it", async () => {
  const { exec, calls } = fakeOsascript('screen: ❯ 1. Yes\n   2. No');
  assert.equal(await iterm(exec).screen('/dev/ttys004'), ' ❯ 1. Yes\n   2. No');
  assert.equal(calls[0][0], 'osascript');
  assert.equal(calls[0].at(-1), '/dev/ttys004', 'the tty reaches the script as an argument');
  assert.equal(await iterm(fakeOsascript('missing').exec).screen('/dev/ttys009'), null);
});

test('pressKey sends a dialog key to an iTerm tab as the characters a terminal sends for it', async () => {
  const { exec, calls } = fakeOsascript('pressed');
  for (const key of ['2', 'Right', 'Up', 'Down', 'Tab']) assert.equal(await iterm(exec).pressKey('/dev/ttys004', key), true);
  assert.deepEqual(calls.map((call) => call.slice(-2)), [
    ['/dev/ttys004', '2'], ['/dev/ttys004', '\x1b[C'], ['/dev/ttys004', '\x1b[A'], ['/dev/ttys004', '\x1b[B'], ['/dev/ttys004', '\t'],
  ]);
  assert.equal(await iterm(fakeOsascript('missing').exec).pressKey('/dev/ttys009', '1'), false);
});

test('enterLine types a line into an iTerm tab, then presses Return on its own, as a dialog\'s text field needs', async () => {
  const { exec, calls } = fakeOsascript('typed');
  assert.equal(await iterm(exec).enterLine('/dev/ttys004', 'a tortoise named "Shelly"'), true);
  assert.deepEqual(calls[0].slice(-2), ['/dev/ttys004', 'a tortoise named "Shelly"']);
  assert.match(calls[0][2], /newline no[\s\S]*delay[\s\S]*ASCII character 13/, 'Return goes separately, after a pause');
  await rejectsWith(iterm(exec).enterLine('/dev/ttys004', 'one\ntwo'), 400);
  assert.equal(await iterm(fakeOsascript('missing').exec).enterLine('/dev/ttys009', 'x'), false);
});

test('pressKey presses no other key', async () => {
  const { exec, calls } = fakeOsascript('pressed');
  for (const key of ['0', '12', 'Enter', 'Escape', 'Left', '\r', 'C-c']) await rejectsWith(iterm(exec).pressKey('/dev/ttys004', key), 400);
  assert.equal(calls.length, 0);
});

test("only iTerm's screen can be read and answered; Terminal can't take keys without bringing its tab forward", async () => {
  assert.equal(canReadScreen('iTerm'), true);
  assert.equal(canReadScreen('Terminal'), false);
  assert.equal(canReadScreen('Konsole'), false);
  await rejectsWith(createTerminal({ app: 'Terminal', platform: 'darwin', exec: fakeOsascript().exec }).screen('/dev/ttys004'), 501);
});
