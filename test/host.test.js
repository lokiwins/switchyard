import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appNameFromPath, createHostDetector, describeHost, findHost, hostsFor, parseProcessTable } from '../src/agents/host.js';

const table = parseProcessTable([
  '  100     1 ?? /Applications/iTerm.app/Contents/MacOS/iTerm2',
  '  200   100 ?? /usr/bin/login',
  '  300   200 ?? -zsh',
  '  400   300 ttys004 claude',
  '  500     1 ?? /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '  510   500 ?? /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
  '  520   510 ?? /bin/zsh',
  '  530   520 ?? claude',
  '  600     1 ?? /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
  '  610   600 ?? codex',
  '  700     1 ?? /usr/sbin/sshd',
  '  710   700 ?? claude',
  '  800     1 ?? tmux',
  '  810   800 ttys010 -zsh',
  '  820   810 ttys010 claude',
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

test('parseProcessTable reads each process tty, null when it has none', () => {
  assert.equal(table.get(400).tty, '/dev/ttys004');
  assert.equal(table.get(100).tty, null);
});

test('hostsFor names the tmux session, window and pane a session runs in', () => {
  const pane = { session: 'switchyard', window: '@4', windowName: 'my-repo-fix', pane: '%3' };
  const panes = new Map([['/dev/ttys010', pane]]);
  const hosts = hostsFor([400, 820, 710], table, panes);
  assert.equal(hosts.get(400).app, 'iTerm');
  assert.equal(hosts.get(400).tty, '/dev/ttys004', "a terminal session's tab is found by its tty");
  assert.deepEqual(hosts.get(820), { kind: 'tmux', label: 'tmux', ...pane });
  assert.equal(hosts.get(710), null);
});

test('the host detector lists every process only for sessions it has not seen, but tmux panes every time', async () => {
  let listings = 0;
  let panes = new Map();
  const detect = createHostDetector({
    processes: async () => { listings += 1; return table; },
    listTmuxPanes: async () => panes,
  });
  assert.equal((await detect([400, 820])).get(400).app, 'iTerm');
  const pane = { session: 'switchyard', window: '@4', windowName: 'my-repo-fix', pane: '%3' };
  panes = new Map([['/dev/ttys010', pane]]);
  const hosts = await detect([400, 820]);
  assert.equal(listings, 1);
  assert.deepEqual(hosts.get(820), { kind: 'tmux', label: 'tmux', ...pane });
  await detect([400]);
  await detect([400, 820]);
  assert.equal(listings, 2, 'a pid that went away is looked up again, since pids are reused');
});

test('the host detector gives no hosts when ps fails, and a pid ps did not list stays unknown', async () => {
  const failing = createHostDetector({ processes: async () => { throw new Error('ps failed'); } });
  assert.deepEqual(await failing([400]), new Map());
  const detect = createHostDetector({ processes: async () => table });
  assert.equal((await detect([99999])).get(99999), null);
  assert.deepEqual(await detect([]), new Map());
});
