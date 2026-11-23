import { expect, test } from 'vitest';
import { answerElsewhere, canShowTerminalSessions, foldsWhenParked, sessionDetail, sessionTitle } from './session-text';
import type { LiveSession, Transcript } from './types';

/** A host as the server sends it, nulls and all. */
type HostFixture = { kind: string } & Record<string, unknown>;

/** A live session as the server sends it: these fields, nulls and all, over a plain waiting one. */
const live = (fields: Record<string, unknown>, transcript: Transcript = {}) =>
  ({ sessionId: 'abcdef12-0000', pid: 1, cwd: '/w/my-repo', status: 'idle', statusUpdatedAt: 0, ...fields, transcript }) as LiveSession;

test('sessionTitle prefers a name you chose, then Claude\'s name or title', () => {
  expect(sessionTitle(live({ name: 'Login bug', nameIsCustom: true }, { title: 'AI title' }))).toBe('Login bug');
  expect(sessionTitle(live({ name: 'my-repo-3f' }, { title: 'AI title' }))).toBe('AI title');
  expect(sessionTitle(live({ name: 'my-repo-3f' }, { agentName: 'renamed', title: 'AI title' }))).toBe('renamed');
});

test('sessionTitle never shows the generated "<folder>-<hex>" name: your prompt stands in until Claude titles it', () => {
  expect(sessionTitle(live({ name: 'my-repo-3f' }, { lastPrompt: 'Fix the  login\nredirect' }))).toBe('Fix the login redirect');
  expect(sessionTitle(live({ name: 'my-repo-3f' }))).toBe('New session');
  expect(sessionTitle(live({ name: null }, { lastPrompt: '   ' }))).toBe('New session');
});

test('sessionTitle cuts a long prompt to about a line, at a word', () => {
  const prompt = 'Refactor the pull request sync so that GitHub lookups are batched and retried with backoff when rate limited';
  const title = sessionTitle(live({}, { lastPrompt: prompt }));
  expect(title.length <= 80, title).toBeTruthy();
  expect(title.endsWith('…')).toBeTruthy();
  expect(prompt.startsWith(title.slice(0, -1))).toBeTruthy();
  expect(!title.slice(0, -1).endsWith(' ')).toBeTruthy();
});

test('the detail line doesn\'t repeat a prompt that is already the title', () => {
  expect(sessionDetail(live({}, { lastPrompt: 'Fix the login redirect' }))).toBe(null);
  expect(sessionDetail(live({}, { title: 'Login redirect fix', lastPrompt: 'Fix the login redirect' }))).toStrictEqual({ kind: 'prompt', label: 'You', text: 'Fix the login redirect' });
});

test('a session that needs you says so, with the question when the transcript has it', () => {
  expect(sessionDetail(live({ needsYou: true }, { lastReply: 'old reply' }))).toStrictEqual({ kind: 'needs-you', label: 'Needs you', text: 'Waiting for your answer or approval' });
  expect(sessionDetail(live({ needsYou: true }, { activity: 'Asking: Which branch?' }))?.text).toBe('Asking: Which branch?');
});

test('a working session never shows the previous turn\'s reply', () => {
  expect(sessionDetail(live({ status: 'busy' }, { lastReply: 'previous turn' }))).toStrictEqual({ kind: 'activity', label: null, text: 'Thinking…' });
  expect(sessionDetail(live({ status: 'busy' }, { activity: 'Editing a.js', lastReply: 'x' }))?.text).toBe('Editing a.js');
  expect(sessionDetail(live({ status: 'busy', inBackground: true }, { lastReply: 'x' }))?.text).toBe('Waiting for a background command');
});

test('waiting and ended sessions show the last reply, or how an interrupted one was cut off', () => {
  expect(sessionDetail(live({}, { lastReply: 'Done.' }))?.text).toBe('Done.');
  expect(sessionDetail({ endState: 'interrupted', transcript: { activity: 'Reading a.js' } })).toStrictEqual({ kind: 'cut-off', label: 'Cut off while', text: 'Reading a.js' });
  expect(sessionDetail({ transcript: { title: 'Greeting', lastPrompt: 'hi' } })).toStrictEqual({ kind: 'prompt', label: 'You', text: 'hi' });
});

test('a waiting session whose dialog was read off its screen shows the question and options, and the dialog when opened', () => {
  const screenPrompt = {
    question: 'Which color do you prefer?',
    options: [{ number: 1, label: 'Red', selected: true }, { number: 2, label: 'Blue', selected: false }],
    text: 'Which color do you prefer?\n❯ 1. Red\n  2. Blue',
  };
  expect(sessionDetail(live({ needsYou: true, screenPrompt }, { activity: 'Asking: colors' }))).toStrictEqual({
    kind: 'needs-you', label: 'Asks', text: 'Which color do you prefer? 1. Red · 2. Blue', full: screenPrompt.text,
  });
  expect(sessionDetail(live({ needsYou: true, screenPrompt: { ...screenPrompt, question: null } }))?.text).toBe('1. Red · 2. Blue');
});

test("a session waiting where switchyard can't answer says where to answer it, and how to answer from here", () => {
  const waiting = (host: HostFixture | null) => live({ needsYou: true, host });
  expect(answerElsewhere(waiting({ kind: 'editor', label: 'VS Code' }), [])).toBe('Answer it in VS Code. To answer from here, run Claude in tmux or start it with New task.');
  expect(answerElsewhere(waiting({ kind: 'terminal', label: 'Terminal', app: 'Terminal' }), [])).toMatch(/^Answer it in Terminal\./);
  expect(answerElsewhere(waiting(null), [])).toMatch(/^Answer it in its terminal\./);
});

test('no hint where the page can already answer: tmux, iTerm, or a prompt the hook sent', () => {
  expect(answerElsewhere({ needsYou: true, host: { kind: 'tmux' } }, [])).toBe(null);
  expect(answerElsewhere({ needsYou: true, host: { kind: 'terminal', label: 'iTerm', app: 'iTerm' } }, [])).toBe(null);
  expect(answerElsewhere({ needsYou: true, host: { kind: 'editor', label: 'VS Code' } }, [{ id: 'a' }])).toBe(null);
  expect(answerElsewhere({ needsYou: false, host: { kind: 'editor', label: 'VS Code' } }, [])).toBe(null);
});

test('a parked session stays in the list while its terminal is open; only ones with no tab fold away', () => {
  const parked = (host: HostFixture | null) => live({ parked: true, host });
  expect(foldsWhenParked(parked({ kind: 'tmux', label: 'tmux', window: '@3' }))).toBe(false);
  expect(foldsWhenParked(parked({ kind: 'terminal', app: 'iTerm', label: 'iTerm', tty: '/dev/ttys004' }))).toBe(false);
  expect(foldsWhenParked(parked({ kind: 'terminal', app: 'Terminal', label: 'Terminal', tty: '/dev/ttys005' }))).toBe(false);
  expect(foldsWhenParked(parked({ kind: 'editor', label: 'VS Code', scheme: 'vscode' }))).toBe(false);
  // No tab to go back to: an app that isn't a terminal, a terminal tab whose tty is unknown, or no host found.
  expect(foldsWhenParked(parked({ kind: 'app', label: 'ChatGPT' }))).toBe(true);
  expect(foldsWhenParked(parked({ kind: 'terminal', app: 'iTerm', label: 'iTerm', tty: null }))).toBe(true);
  expect(foldsWhenParked(parked(null))).toBe(true);
  // A session that isn't parked never folds.
  expect(foldsWhenParked(live({ parked: false, host: null }))).toBe(false);
});

test('Show Terminal Sessions is offered with tmux and iTerm only, since it uses iTerm\'s tmux integration', () => {
  expect(canShowTerminalSessions({ terminal: 'iTerm', tmux: true })).toBe(true);
  expect(canShowTerminalSessions({ terminal: 'iTerm', tmux: false })).toBe(false);
  expect(canShowTerminalSessions({ terminal: 'Terminal', tmux: true })).toBe(false);
  expect(canShowTerminalSessions(undefined)).toBe(false);
});
