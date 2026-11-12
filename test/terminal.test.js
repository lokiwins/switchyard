import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAnswerIn, canReadScreen, createTerminal } from '../src/terminal.js';

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

test("iTerm and Terminal screens can be read, but only iTerm takes keys: Terminal can't without bringing its tab forward", async () => {
  assert.deepEqual(['iTerm', 'Terminal', 'Konsole'].map(canReadScreen), [true, true, false]);
  assert.deepEqual(['iTerm', 'Terminal', 'Konsole'].map(canAnswerIn), [true, false, false]);
  const terminal = createTerminal({ app: 'Terminal', platform: 'darwin', exec: fakeOsascript('pressed').exec });
  await rejectsWith(terminal.pressKey('/dev/ttys004', '1'), 501);
});

test("screen reads a Terminal tab's text by its tty", async () => {
  const { exec, calls } = fakeOsascript('screen:Do you want to proceed?');
  assert.equal(await createTerminal({ app: 'Terminal', platform: 'darwin', exec }).screen('/dev/ttys004'), 'Do you want to proceed?');
  // In a loop, "contents of t" is AppleScript's own contents (the tab itself); the tab's text needs it twice.
  assert.match(calls[0][2], /application "Terminal"[\s\S]*contents of \(contents of t\)/);
  assert.equal(calls[0].at(-1), '/dev/ttys004');
});

test('focusTmuxPane brings forward the iTerm window or tab its tmux integration shows a pane in, by the pane number', async () => {
  const { exec, calls } = fakeOsascript('found');
  assert.equal(await iterm(exec).focusTmuxPane('%12'), true);
  assert.equal(calls[0].at(-1), '12', 'the pane number reaches the script as an argument');
  assert.match(calls[0].join(' '), /tmuxWindowPane/);
  assert.equal(await iterm(fakeOsascript('missing').exec).focusTmuxPane('%12'), false);
});

test('focusTmuxPane takes only a pane id, and is false where there is no tmux integration (Terminal)', async () => {
  const { exec, calls } = fakeOsascript('found');
  for (const pane of ['12', '%1; rm', '@3', '']) await rejectsWith(iterm(exec).focusTmuxPane(pane), 400);
  assert.equal(await createTerminal({ app: 'Terminal', platform: 'darwin', exec }).focusTmuxPane('%12'), false);
  assert.equal(calls.length, 0);
});
