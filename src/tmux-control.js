import { spawn } from 'node:child_process';
import { findOnPath } from './tmux.js';

/*
 * tmux control mode (`tmux -C`): a client that talks to tmux over plain pipes
 * instead of a terminal, as iTerm2's tmux integration does. tmux reports what
 * each pane prints as `%output %3 <bytes>` lines and runs commands written to
 * stdin, so switchyard can mirror a pane and type into it without a pty.
 */

const NEWLINE = 0x0a;
const BACKSLASH = 0x5c;
const OCTAL_DIGIT = /^[0-7]{3}$/;

/** `%output` escapes control characters and backslash as \ooo; everything else (including UTF-8) is sent raw. */
export function decodeOutput(bytes) {
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const octal = bytes[i] === BACKSLASH ? bytes.subarray(i + 1, i + 4).toString('latin1') : '';
    if (OCTAL_DIGIT.test(octal)) {
      out[length] = parseInt(octal, 8);
      i += 3;
    } else {
      out[length] = bytes[i];
    }
    length += 1;
  }
  return out.subarray(0, length);
}

/**
 * One line from a control client, as { type, ... }:
 * output (pane, data), pause/continue (pane), subscription (name, pane, value),
 * exit, begin/end/error (command replies), or line (anything else, e.g. a
 * command's output).
 */
export function parseControlLine(line) {
  const text = line.toString('latin1');
  const output = /^%output (%\d+) /.exec(text);
  if (output) return { type: 'output', pane: output[1], data: decodeOutput(line.subarray(output[0].length)) };
  // %extended-output %3 <age> ... : <data>, sent instead of %output once flow control is on.
  const extended = /^%extended-output (%\d+) .*? : /.exec(text);
  if (extended) return { type: 'output', pane: extended[1], data: decodeOutput(line.subarray(extended[0].length)) };
  // %subscription-changed <name> <session> <window> <window index> <pane> ... : <value>
  const subscription = /^%subscription-changed (\S+) \S+ \S+ \S+ (\S+)(?: \S+)*? : (.*)$/.exec(text);
  if (subscription) return { type: 'subscription', name: subscription[1], pane: subscription[2], value: subscription[3] };
  const paneEvent = /^%(pause|continue) (%\d+)$/.exec(text);
  if (paneEvent) return { type: paneEvent[1], pane: paneEvent[2] };
  const reply = /^%(begin|end|error) /.exec(text);
  if (reply) return { type: reply[1] };
  if (text.startsWith('%exit')) return { type: 'exit' };
  return { type: 'line', text: line.toString('utf8') };
}

/** Splits a byte stream into lines, keeping a partial last line for the next chunk. */
export function createLineSplitter(onLine) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    let data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let newline = data.indexOf(NEWLINE);
    while (newline !== -1) {
      onLine(data.subarray(0, newline));
      data = data.subarray(newline + 1);
      newline = data.indexOf(NEWLINE);
    }
    pending = Buffer.from(data);
  };
}

/** Bytes as the hex arguments of `send-keys -H`, which types them exactly. */
export const hexKeys = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

/**
 * A control client attached to `session`. Calls onEvent with each parsed
 * line and onClose once the client has gone. `command` writes one tmux
 * command; `close` detaches.
 */
export function attachControlClient({ session, onEvent, onClose, spawnTmux = defaultSpawn }) {
  const child = spawnTmux(['-C', 'attach-session', '-t', `=${session}`]);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  child.stdout.on('data', createLineSplitter((line) => onEvent(parseControlLine(line))));
  child.on('exit', finish);
  child.on('error', finish);
  // A write after the client has gone fails with EPIPE; the exit handler reports the close.
  child.stdin.on('error', () => {});
  return {
    command(line) {
      if (closed) return;
      if (/[\r\n]/.test(line)) throw new Error('A tmux command must be one line');
      child.stdin.write(`${line}\n`);
    },
    close() {
      if (closed) return;
      child.stdin.end();
      setTimeout(() => { if (!closed) child.kill(); }, 1000).unref();
    },
  };
}

function defaultSpawn(args) {
  return spawn(findOnPath('tmux'), args, { stdio: ['pipe', 'pipe', 'ignore'] });
}
