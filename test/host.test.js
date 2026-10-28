import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appNameFromPath, describeHost, findHost, parseProcessTable } from '../src/agents/host.js';

const table = parseProcessTable([
  '  100     1 /Applications/iTerm.app/Contents/MacOS/iTerm2',
  '  200   100 /usr/bin/login',
  '  300   200 -zsh',
  '  400   300 claude',
  '  500     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '  510   500 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
  '  520   510 /bin/zsh',
  '  530   520 claude',
  '  600     1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
  '  610   600 codex',
  '  700     1 /usr/sbin/sshd',
  '  710   700 claude',
].join('\n'));

test('parseProcessTable keeps commands that contain spaces', () => {
  assert.equal(table.get(510).command.endsWith('Code Helper (Plugin)'), true);
  assert.equal(table.get(510).ppid, 500);
});

test('appNameFromPath returns the outermost bundle so helper processes map to their app', () => {
  assert.equal(appNameFromPath('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/x'), 'Visual Studio Code');
  assert.equal(appNameFromPath('/usr/bin/login'), null);
});

test('findHost walks up to the app the session runs in', () => {
  assert.deepEqual(findHost(400, table), { kind: 'terminal', label: 'iTerm', app: 'iTerm', appName: 'iTerm' });
  assert.equal(findHost(530, table).kind, 'editor');
  assert.equal(findHost(530, table).scheme, 'vscode');
  assert.deepEqual(findHost(610, table), { kind: 'app', label: 'ChatGPT', appName: 'ChatGPT' });
});

test('findHost returns null for sessions with no app ancestor, like over ssh', () => {
  assert.equal(findHost(710, table), null);
  assert.equal(findHost(99999, table), null);
});

test('describeHost knows the common editors by their URL scheme', () => {
  assert.equal(describeHost('Cursor').scheme, 'cursor');
  assert.equal(describeHost('Windsurf').scheme, 'windsurf');
  assert.equal(describeHost(null), null);
});
