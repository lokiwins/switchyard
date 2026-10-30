import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClaudeProvider, readStatus, resumeCommand, summarizeTranscript, transcriptDirName } from '../src/agents/claude.js';
import { classifyEnding } from '../src/agents/claude-transcript.js';

const line = (entry) => JSON.stringify(entry);

test('transcriptDirName replaces every non-alphanumeric character', () => {
  assert.equal(transcriptDirName('/Users/jane.doe/code/repo_x'), '-Users-jane-doe-code-repo-x');
});

test('summarizeTranscript finds the last human prompt and skips tool results, meta and compactions', () => {
  const lines = [
    line({ type: 'user', origin: { kind: 'human' }, message: { content: 'first ask' }, timestamp: '2026-01-01T00:00:00Z', gitBranch: 'feat' }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'output' }] }, timestamp: '2026-01-01T00:01:00Z' }),
    line({ type: 'user', isMeta: true, message: { content: '<local-command-caveat>x' } }),
    line({ type: 'user', isCompactSummary: true, message: { content: 'This session is being continued…' } }),
    line({ type: 'pr-link', prNumber: 12, prUrl: 'https://github.com/o/r/pull/12' }),
    line({ type: 'pr-link', prNumber: 12, prUrl: 'https://github.com/o/r/pull/12' }),
    '{"truncated',
  ];

  const summary = summarizeTranscript(lines);

  assert.equal(summary.lastPrompt, 'first ask');
  assert.equal(summary.gitBranch, 'feat');
  assert.equal(summary.lastActivityAt, Date.parse('2026-01-01T00:01:00Z'));
  assert.deepEqual(summary.prLinks, [{ number: 12, url: 'https://github.com/o/r/pull/12' }]);
});

test('summarizeTranscript reads text parts of array content and truncates long prompts', () => {
  const long = 'word '.repeat(200);
  const summary = summarizeTranscript([
    line({ type: 'user', message: { content: [{ type: 'text', text: long }] } }),
  ]);
  assert.ok(summary.lastPrompt.endsWith('…'));
  assert.ok(summary.lastPrompt.length <= 600);
});

test('readStatus folds Claude Code statuses into working or waiting, keeping why', () => {
  assert.deepEqual(readStatus('busy'), { status: 'busy', needsYou: false, inBackground: false });
  assert.deepEqual(readStatus('idle'), { status: 'idle', needsYou: false, inBackground: false });
  // An open question or permission prompt: waiting on you, and more urgently than an idle session.
  assert.deepEqual(readStatus('waiting'), { status: 'idle', needsYou: true, inBackground: false });
  // A background command is running; Claude resumes by itself when it finishes.
  assert.deepEqual(readStatus('shell'), { status: 'busy', needsYou: false, inBackground: true });
  assert.deepEqual(readStatus(undefined), { status: 'unknown', needsYou: false, inBackground: false });
});

async function makeClaudeDir() {
  const dir = await mkdtemp(join(tmpdir(), 'gwm-claude-'));
  await mkdir(join(dir, 'sessions'));
  await mkdir(join(dir, 'projects'));
  return dir;
}

test('liveSessions keeps only running processes and finds prompts beyond the tail window', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/tmp/some.repo';
  const sessionId = 'abc-123';
  await writeFile(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({
    pid: process.pid, sessionId, cwd, name: 'live-one', nameSource: 'user', status: 'waiting', statusUpdatedAt: 5,
  }));
  await writeFile(join(claudeDir, 'sessions', '999999999.json'), JSON.stringify({
    pid: 999_999_999, sessionId: 'dead', cwd, status: 'busy',
  }));
  const projectDir = join(claudeDir, 'projects', transcriptDirName(cwd));
  await mkdir(projectDir);
  // Push the prompt well past the 256KB tail with tool-result noise.
  const noise = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(1000) }] } });
  const transcript = [
    line({ type: 'user', origin: { kind: 'human' }, message: { content: 'héllo — find me' } }),
    ...Array.from({ length: 2000 }, () => noise),
  ].join('\n');
  await writeFile(join(projectDir, `${sessionId}.jsonl`), transcript);

  const sessions = await createClaudeProvider({ claudeDir }).liveSessions();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].name, 'live-one');
  assert.equal(sessions[0].nameIsCustom, true);
  assert.equal(sessions[0].status, 'idle');
  assert.equal(sessions[0].needsYou, true);
  assert.equal(sessions[0].resumeCommand, 'cd /tmp/some.repo && claude --resume abc-123');
  assert.equal(sessions[0].transcript.lastPrompt, 'héllo — find me');
});

test('latestSession returns the newest transcript for a directory, or null', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/tmp/repo';
  const projectDir = join(claudeDir, 'projects', transcriptDirName(cwd));
  await mkdir(projectDir);
  await writeFile(join(projectDir, 'old.jsonl'), line({ type: 'user', message: { content: 'old' } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(projectDir, 'new.jsonl'), line({ type: 'user', message: { content: 'new' } }));

  const provider = createClaudeProvider({ claudeDir });
  const latest = await provider.latestSession(cwd);

  assert.equal(latest.sessionId, 'new');
  assert.equal(latest.transcript.lastPrompt, 'new');
  assert.equal(await provider.latestSession('/tmp/nothing-here'), null);
});

test('recentSessions lists a folder\'s sessions newest first, skipping excluded and promptless ones', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/tmp/recent-repo';
  const projectDir = join(claudeDir, 'projects', transcriptDirName(cwd));
  await mkdir(projectDir);
  const write = async (id, entries) => {
    await writeFile(join(projectDir, `${id}.jsonl`), entries.map(line).join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 15));
  };
  await write('first', [{ type: 'user', message: { content: 'oldest ask' } }]);
  await write('second', [{ type: 'user', message: { content: 'middle ask' } }]);
  await write('empty', [{ type: 'summary' }]);
  await write('running', [{ type: 'user', message: { content: 'live one' } }]);

  const provider = createClaudeProvider({ claudeDir });
  const recent = await provider.recentSessions(cwd, { limit: 5, exclude: new Set(['running']) });

  assert.deepEqual(recent.map((s) => s.sessionId), ['second', 'first']);
  assert.equal(recent[0].resumeCommand, 'cd /tmp/recent-repo && claude --resume second');
  assert.equal(recent[0].transcript.lastPrompt, 'middle ask');
  assert.equal((await provider.recentSessions(cwd, { limit: 1 })).length, 1);
  assert.deepEqual(await provider.recentSessions('/tmp/nothing-here'), []);
});

const user = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
const assistant = (content) => ({ type: 'assistant', message: { content } });

test('classifyEnding detects sessions that died mid-turn', () => {
  assert.equal(classifyEnding([user('fix the bug', { origin: { kind: 'human' } })]), 'interrupted');
  assert.equal(classifyEnding([user('go'), assistant([{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Bash' }])]), 'interrupted');
  assert.equal(classifyEnding([user('go'), assistant([{ type: 'tool_use' }]), user([{ type: 'tool_result', content: 'x' }])]), 'interrupted');
});

test('classifyEnding recognises finished turns, Esc and /exit', () => {
  assert.equal(classifyEnding([user('go'), assistant([{ type: 'text', text: 'done' }])]), 'finished');
  assert.equal(classifyEnding([user('go'), user([{ type: 'text', text: '[Request interrupted by user for tool use]' }])]), 'stopped');
  assert.equal(classifyEnding([
    user('<local-command-caveat>x', { isMeta: true }),
    user('<command-name>/exit</command-name>\n<command-message>exit</command-message>'),
    user('<local-command-stdout>Goodbye!</local-command-stdout>'),
  ]), 'exited');
  assert.equal(classifyEnding([user('<command-name>/mcp</command-name>'), user('<local-command-stdout>ok</local-command-stdout>')]), 'finished');
});

test('classifyEnding skips compaction summaries and sidechains, and reports unknown without conversation', () => {
  assert.equal(classifyEnding([
    assistant([{ type: 'text', text: 'done' }]),
    user('This session is being continued…', { isCompactSummary: true }),
    user('sub-agent prompt', { isSidechain: true }),
  ]), 'finished');
  assert.equal(classifyEnding([{ type: 'mode' }, { type: 'ai-title', aiTitle: 't' }]), 'unknown');
});

test('summarizeTranscript reads the AI title, agent name and working directory', () => {
  const summary = summarizeTranscript([
    line({ type: 'user', origin: { kind: 'human' }, message: { content: 'hi' }, cwd: '/w/repo' }),
    line({ type: 'ai-title', aiTitle: 'Fix login bug' }),
    line({ type: 'agent-name', agentName: 'login-fixer' }),
  ]);
  assert.equal(summary.title, 'Fix login bug');
  assert.equal(summary.agentName, 'login-fixer');
  assert.equal(summary.cwd, '/w/repo');
  assert.equal(summary.endState, 'interrupted');
});

test('resumeCommand changes into the session directory, quoting when needed', () => {
  assert.equal(resumeCommand('/w/repo', 'id1'), 'cd /w/repo && claude --resume id1');
  assert.equal(resumeCommand("/w/it's here", 'id2'), "cd '/w/it'\\''s here' && claude --resume id2");
});

test('endedSessions lists recent, non-live transcripts with where and how they ended', async () => {
  const claudeDir = await makeClaudeDir();
  const projectDir = join(claudeDir, 'projects', transcriptDirName('/w/repo'));
  await mkdir(projectDir);
  const write = (id, entries) => writeFile(join(projectDir, `${id}.jsonl`), entries.map(line).join('\n'));
  await write('died', [{ type: 'user', origin: { kind: 'human' }, cwd: '/w/repo', timestamp: '2026-01-01T00:00:00Z', message: { content: 'refactor' } }]);
  await write('live', [{ type: 'user', cwd: '/w/repo', message: { content: 'x' } }]);
  await write('no-cwd', [{ type: 'mode' }]);
  await write('empty-exit', [
    { type: 'user', cwd: '/w/repo', message: { content: '<command-name>/exit</command-name>' } },
    { type: 'user', cwd: '/w/repo', message: { content: '<local-command-stdout>Bye!</local-command-stdout>' } },
  ]);

  const sessions = await createClaudeProvider({ claudeDir }).endedSessions({ since: 0, liveSessionIds: new Set(['live']) });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'died');
  assert.equal(sessions[0].endState, 'interrupted');
  assert.equal(sessions[0].endedAt, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(sessions[0].resumeCommand, 'cd /w/repo && claude --resume died');
});
