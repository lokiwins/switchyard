import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionError } from '../src/errors.js';
import { createLiveTerminals, parseSize, seedBytes } from '../src/live-terminal.js';

const SESSION = 'c9c573f7-e5a4-4da9-9837-c8fe1b428fc2';

function setup({ target = { session: 'switchyard', pane: '%3' }, failCapture = false, resizeDuringCapture = false } = {}) {
  const commands = [];
  let client = null;
  // The pane's real size, which a test can change as tmux would.
  const pane = { window: '@4', cols: 80, rows: 24, cursorX: 2, cursorY: 1 };
  const attach = ({ session, onEvent, onClose }) => {
    client = { session, onEvent, onClose, closed: false };
    return { command: (line) => commands.push(line), close: () => { client.closed = true; } };
  };
  const tmux = {
    paneSize: async () => ({ ...pane }),
    capturePane: async () => {
      // Output the pane prints while it's being captured.
      client.onEvent({ type: 'output', pane: '%3', data: Buffer.from('during') });
      if (resizeDuringCapture && pane.cols === 80) {
        Object.assign(pane, { cols: 100, rows: 30 });
        client.onEvent({ type: 'subscription', name: 'size', pane: '%3', value: '100x30' });
      }
      if (failCapture) throw new ActionError(502, 'tmux: boom');
      return Buffer.from('line one\n$ \n');
    },
  };
  const actions = {
    tmuxTarget: async (body) => {
      if (body.sessionId !== SESSION) throw new ActionError(404, "That session isn't running");
      return target;
    },
  };
  const terminals = createLiveTerminals({ actions, tmux, attach, newToken: () => 'tok' });
  const sink = {
    events: [],
    ready: (r) => sink.events.push(['ready', r]),
    output: (b) => sink.events.push(['output', b.toString()]),
    resize: (size) => sink.events.push(['resize', size]),
    end: () => sink.events.push(['end']),
  };
  return { terminals, sink, commands, pane, client: () => client };
}

test('seedBytes redraws the capture with CRLF line ends and puts the cursor back', () => {
  assert.equal(seedBytes(Buffer.from('a\nb\n'), { cursorX: 4, cursorY: 1 }).toString(), '\x1b[0ma\r\nb\x1b[2;5H');
});

test('start attaches to the pane\'s session, sends size and screen, then output that arrived meanwhile', async () => {
  const { terminals, sink, client } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  assert.equal(client().session, 'switchyard');
  assert.deepEqual(sink.events, [
    ['ready', { token: 'tok', cols: 80, rows: 24 }],
    ['output', '\x1b[0mline one\r\n$ \x1b[2;3H'],
    ['output', 'during'],
  ]);
});

test('start passes on the pane\'s output as it arrives, and only that pane\'s', async () => {
  const { terminals, sink, client } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  client().onEvent({ type: 'output', pane: '%9', data: Buffer.from('other pane') });
  client().onEvent({ type: 'line', text: '80x24' });
  client().onEvent({ type: 'output', pane: '%3', data: Buffer.from('live') });
  assert.deepEqual(sink.events.at(-1), ['output', 'live']);
  assert.equal(sink.events.length, 4);
});

test('start refuses sessions the terminal cannot reach', async () => {
  const { terminals, sink } = setup();
  await assert.rejects(terminals.start({ sessionId: 'nope' }, sink), (error) => error.status === 404);
});

test('start detaches again when the screen cannot be captured', async () => {
  const { terminals, sink, client } = setup({ failCapture: true });
  await assert.rejects(terminals.start({ sessionId: SESSION }, sink), (error) => error.status === 502);
  assert.equal(client().closed, true);
});

test('the function start resolves to detaches the control client', async () => {
  const { terminals, sink, client } = setup();
  const close = await terminals.start({ sessionId: SESSION }, sink);
  close();
  assert.equal(client().closed, true);
});

test('input types the exact bytes into the pane with the terminal\'s token', async () => {
  const { terminals, sink, commands } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  assert.deepEqual(terminals.input({ token: 'tok', data: '\x1b[Aé' }), { sent: 5 });
  assert.deepEqual(commands.at(-1), 'send-keys -t %3 -H 1b 5b 41 c3 a9');
});

test('input refuses unknown tokens, empty input and too much at once', async () => {
  const { terminals, sink } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  assert.throws(() => terminals.input({ token: 'guess', data: 'x' }), (error) => error.status === 404);
  assert.throws(() => terminals.input({ token: 'tok', data: '' }), (error) => error.status === 400);
  assert.throws(() => terminals.input({ token: 'tok', data: 'x'.repeat(2049) }), (error) => error.status === 413);
});

test('a terminal whose control client goes away ends its stream and forgets its token', async () => {
  const { terminals, sink, client } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  client().onClose();
  assert.deepEqual(sink.events.at(-1), ['end']);
  assert.throws(() => terminals.input({ token: 'tok', data: 'x' }), (error) => error.status === 404);
});

test('parseSize reads tmux\'s WxH', () => {
  assert.deepEqual(parseSize('120x40'), { cols: 120, rows: 40 });
  assert.equal(parseSize('nope'), null);
});

test('start subscribes to the pane\'s size, quoted so tmux doesn\'t read # as a comment', async () => {
  const { terminals, sink, commands } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  assert.deepEqual(commands, ["refresh-client -B 'size:%3:#{pane_width}x#{pane_height}'"]);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const CLEAR = '\x1b[H\x1b[2J\x1b[3J';

test('a size change redraws the page from a fresh copy of the screen, once, and only for the pane', async () => {
  const { terminals, sink, client, pane } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  const size = (id, value) => client().onEvent({ type: 'subscription', name: 'size', pane: id, value });
  size('%3', '80x24');
  size('%9', '50x10');
  Object.assign(pane, { cols: 120, rows: 40 });
  size('%3', '120x40');
  size('%3', '120x40');
  await settle();
  const after = sink.events.slice(3);
  // The fake pane prints "during" while each copy is taken; it follows the copy.
  assert.deepEqual(after, [['resize', { cols: 120, rows: 40 }], ['output', `${CLEAR}\x1b[0mline one\r\n$ \x1b[2;3H`], ['output', 'during']]);
});

test('a stale size report does not redraw over and over', async () => {
  const { terminals, sink, client } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  // tmux says 120x40, but the pane measures 80x24 when redrawn.
  client().onEvent({ type: 'subscription', name: 'size', pane: '%3', value: '120x40' });
  for (let i = 0; i < 5; i += 1) await settle();
  assert.ok(sink.events.filter(([kind]) => kind === 'resize').length <= 1);
});

test('a size change while the screen is captured redraws once the page is ready', async () => {
  const { terminals, sink } = setup({ resizeDuringCapture: true });
  await terminals.start({ sessionId: SESSION }, sink);
  await settle();
  assert.deepEqual(sink.events.map(([kind]) => kind), ['ready', 'output', 'output', 'resize', 'output', 'output']);
  assert.deepEqual(sink.events[3], ['resize', { cols: 100, rows: 30 }]);
});

test('resize asks for the size on the terminal\'s window, within sane bounds', async () => {
  const { terminals, sink, commands } = setup();
  await terminals.start({ sessionId: SESSION }, sink);
  assert.deepEqual(terminals.resize({ token: 'tok', cols: 132, rows: 43 }), { requested: { cols: 132, rows: 43 } });
  assert.equal(commands.at(-1), 'refresh-client -C @4:132x43');
  for (const bad of [{ cols: 10, rows: 40 }, { cols: 100, rows: 500 }, { cols: '100', rows: 40 }, { cols: 100.5, rows: 40 }]) {
    assert.throws(() => terminals.resize({ token: 'tok', ...bad }), (error) => error.status === 400, JSON.stringify(bad));
  }
  assert.throws(() => terminals.resize({ token: 'guess', cols: 100, rows: 40 }), (error) => error.status === 404);
});
