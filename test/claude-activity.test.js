import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentActivity, describeTool, lastReply } from '../src/agents/claude-activity.js';

const assistant = (...content) => ({ type: 'assistant', message: { content } });
const text = (value) => ({ type: 'text', text: value });
const toolUse = (name, input) => ({ type: 'tool_use', name, input });
const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } };
const prompt = (value) => ({ type: 'user', message: { content: value } });

test('describeTool turns tool calls into short plain-English activity', () => {
  assert.equal(describeTool('Bash', { command: 'node --test test/', description: 'Run the test suite' }), 'Run the test suite');
  assert.equal(describeTool('Bash', { command: 'git status' }), 'Running git status');
  assert.equal(describeTool('Edit', { file_path: '/w/repo/src/actions.js' }), 'Editing actions.js');
  assert.equal(describeTool('Write', { file_path: '/w/repo/README.md' }), 'Writing README.md');
  assert.equal(describeTool('Read', { file_path: '/w/repo/a.js' }), 'Reading a.js');
  assert.equal(describeTool('Grep', { pattern: 'resumeCommand' }), 'Searching for "resumeCommand"');
  assert.equal(describeTool('Agent', { description: 'Review the diff' }), 'Subagent: Review the diff');
  assert.equal(describeTool('WebSearch', { query: 'iTerm AppleScript' }), 'Searching the web for "iTerm AppleScript"');
  assert.equal(describeTool('AskUserQuestion', { questions: [{ question: 'Which branch?' }] }), 'Asking: Which branch?');
  assert.equal(describeTool('mcp__claude_ai_Slack__slack_send_message', {}), 'slack send message (Slack)');
  assert.equal(describeTool('ToolSearch', { query: 'select:Read' }), 'Loading tools');
  assert.equal(describeTool('SomethingNew', null), 'SomethingNew');
});

test('lastReply is the last thing Claude said in the main conversation', () => {
  const entries = [
    assistant(text('First answer')),
    { ...assistant(text('subagent chatter')), isSidechain: true },
    assistant(text('Done. Tests pass.\n\nWant me to push?'), toolUse('Bash', { command: 'ls' })),
    toolResult,
  ];
  assert.equal(lastReply(entries), 'Done. Tests pass. Want me to push?');
  assert.equal(lastReply([prompt('hi')]), null);
  assert.equal(
    lastReply([assistant(text('## Done\n- **Merged** [PR #2](https://github.com/o/r/pull/2) on `main`'))]),
    'Done Merged PR #2 on main',
  );
});

test('currentActivity describes the in-flight tool call, and is null once the turn is over', () => {
  assert.equal(currentActivity([prompt('go'), assistant(toolUse('Bash', { command: 'npm test' }))]), 'Running npm test');
  assert.equal(currentActivity([prompt('go'), assistant(toolUse('Read', { file_path: '/a/b.js' })), toolResult]), 'Reading b.js');
  assert.equal(currentActivity([prompt('go'), assistant(toolUse('Read', { file_path: '/a/b.js' })), toolResult, assistant(text('All done'))]), null);
  assert.equal(currentActivity([prompt('go')]), null);
});
