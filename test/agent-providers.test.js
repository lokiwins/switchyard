import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentProviders } from '../src/agents/providers.js';
import { createClaudeProvider } from '../src/agents/claude.js';

/** A stand-in agent CLI: its sessions are whatever it's given. */
function fakeProvider(id, { live = [], latest = null, recent = [], ended = [] } = {}) {
  return {
    id,
    label: `${id} agent`,
    command: id,
    launchCommand: (prompt) => (prompt ? `${id} run '${prompt}'` : id),
    resumeCommand: (sessionId) => `${id} resume ${sessionId}`,
    liveSessions: async () => live,
    latestSession: async () => latest,
    recentSessions: async (cwd, { limit = 5, exclude = new Set() } = {}) => recent.filter((s) => !exclude.has(s.sessionId)).slice(0, limit),
    endedSessions: async () => ended,
  };
}

const rejects400 = (fn) => assert.throws(fn, (e) => e.status === 400);

test('the first provider is the default unless another is named, and each is found by id', () => {
  const agents = createAgentProviders([fakeProvider('alpha'), fakeProvider('beta')]);
  assert.equal(agents.default.id, 'alpha');
  assert.deepEqual(agents.list.map((p) => [p.id, p.label]), [['alpha', 'alpha agent'], ['beta', 'beta agent']]);
  assert.equal(agents.get('beta').id, 'beta');
  assert.equal(createAgentProviders([fakeProvider('alpha'), fakeProvider('beta')], { defaultId: 'beta' }).default.id, 'beta');
});

test('an unknown provider is a 400 naming the ones there are', () => {
  const agents = createAgentProviders([fakeProvider('alpha')]);
  rejects400(() => agents.get('codex'));
  rejects400(() => agents.get(undefined));
  assert.throws(() => agents.get('nope'), /alpha/);
});

test('a provider missing part of the interface, a bad id or command, or a repeated id is refused at startup', () => {
  const { endedSessions, ...partial } = fakeProvider('alpha');
  void endedSessions;
  assert.throws(() => createAgentProviders([partial]), /endedSessions/);
  assert.throws(() => createAgentProviders([{ ...fakeProvider('alpha'), id: 'Has Spaces' }]), /id/);
  assert.throws(() => createAgentProviders([{ ...fakeProvider('alpha'), command: 'rm -rf' }]), /command/);
  assert.throws(() => createAgentProviders([fakeProvider('alpha'), fakeProvider('alpha')]), /alpha/);
  assert.throws(() => createAgentProviders([]), /provider/);
  assert.throws(() => createAgentProviders([fakeProvider('alpha')], { defaultId: 'beta' }), /beta/);
});

test('sessions from every provider are listed together, each saying which provider it is', async () => {
  const agents = createAgentProviders([
    fakeProvider('alpha', { live: [{ sessionId: 'a1', cwd: '/w' }], ended: [{ sessionId: 'a2', endedAt: 10 }] }),
    fakeProvider('beta', { live: [{ sessionId: 'b1', cwd: '/w' }], ended: [{ sessionId: 'b2', endedAt: 30 }] }),
  ]);
  assert.deepEqual((await agents.liveSessions()).map((s) => [s.sessionId, s.provider]), [['a1', 'alpha'], ['b1', 'beta']]);
  // Ended sessions are newest first across providers.
  const ended = await agents.endedSessions({ since: 0, liveSessionIds: new Set() });
  assert.deepEqual(ended.map((s) => [s.sessionId, s.provider]), [['b2', 'beta'], ['a2', 'alpha']]);
});

test('a folder\'s latest and recent sessions are the newest across providers', async () => {
  const agents = createAgentProviders([
    fakeProvider('alpha', { latest: { sessionId: 'a', updatedAt: 5 }, recent: [{ sessionId: 'a1', updatedAt: 1 }, { sessionId: 'a3', updatedAt: 3 }] }),
    fakeProvider('beta', { latest: { sessionId: 'b', updatedAt: 9 }, recent: [{ sessionId: 'b2', updatedAt: 2 }, { sessionId: 'b4', updatedAt: 4 }] }),
    fakeProvider('gamma'),
  ]);
  assert.deepEqual(await agents.latestSession('/w'), { sessionId: 'b', updatedAt: 9, provider: 'beta' });
  const recent = await agents.recentSessions('/w', { limit: 3, exclude: new Set(['b4']) });
  assert.deepEqual(recent.map((s) => s.sessionId), ['a3', 'b2', 'a1']);
  assert.equal(await createAgentProviders([fakeProvider('gamma')]).latestSession('/w'), null);
});

test('a session\'s provider resumes it; one from before providers were named is the default\'s', () => {
  const agents = createAgentProviders([fakeProvider('alpha'), fakeProvider('beta')]);
  assert.equal(agents.forSession({ sessionId: 'x', provider: 'beta' }).resumeCommand('x'), 'beta resume x');
  assert.equal(agents.forSession({ sessionId: 'x' }).id, 'alpha');
  rejects400(() => agents.forSession({ sessionId: 'x', provider: 'gone' }));
});

test('Claude is a provider: it launches claude with the task quoted, and resumes by session id', () => {
  const claude = createClaudeProvider({ claudeDir: '/nowhere' });
  const agents = createAgentProviders([claude]);
  assert.deepEqual([claude.id, claude.label, claude.command], ['claude', 'Claude Code', 'claude']);
  assert.equal(claude.launchCommand(), 'claude');
  assert.equal(claude.launchCommand("Fix the user's login"), "claude 'Fix the user'\\''s login'");
  assert.equal(claude.resumeCommand('abc12345-6789'), 'claude --resume abc12345-6789');
  assert.equal(agents.default, claude);
});

test('Claude runs the program and extra options from Settings, read each time, for new and resumed sessions', () => {
  let settings = { enabled: true, program: '~/.local/bin/claude', options: ['--model', 'opus'] };
  const claude = createClaudeProvider({ claudeDir: '/nowhere', home: '/Users/me', settings: () => settings });
  assert.equal(claude.launchCommand('Fix it'), "/Users/me/.local/bin/claude --model opus 'Fix it'");
  assert.equal(claude.launchCommand(), '/Users/me/.local/bin/claude --model opus');
  assert.equal(claude.resumeCommand('abc12345'), '/Users/me/.local/bin/claude --model opus --resume abc12345');
  // What a new task's pane is watched for: the program's own name.
  assert.equal(claude.command, 'claude');
  settings = { enabled: true, program: '/opt/bin/claude-next', options: [] };
  assert.equal(claude.launchCommand('Go'), "/opt/bin/claude-next 'Go'");
  assert.equal(claude.command, 'claude-next');
});

test('Settings choose the default provider and turn providers off: an off one is not listed, offered or started', async () => {
  let settings = { default: 'beta', alpha: { enabled: false }, beta: { enabled: true } };
  const agents = createAgentProviders([
    fakeProvider('alpha', { live: [{ sessionId: 'a1' }], ended: [{ sessionId: 'a2', endedAt: 1 }] }),
    fakeProvider('beta', { live: [{ sessionId: 'b1' }] }),
  ], { settings: () => settings });
  assert.equal(agents.default.id, 'beta');
  assert.deepEqual(agents.list.map((p) => p.id), ['beta']);
  assert.deepEqual((await agents.liveSessions()).map((s) => s.sessionId), ['b1']);
  assert.deepEqual(await agents.endedSessions({ since: 0, liveSessionIds: new Set() }), []);
  assert.throws(() => agents.get('alpha'), (e) => e.status === 409 && /turned off in Settings/.test(e.message));
  // Turned back on in Settings: it's there again, without a restart.
  settings = { default: 'alpha', alpha: { enabled: true }, beta: { enabled: true } };
  assert.equal(agents.default.id, 'alpha');
  assert.deepEqual((await agents.liveSessions()).map((s) => s.sessionId), ['a1', 'b1']);
});
