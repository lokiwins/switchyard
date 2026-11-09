import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseScreenPrompt } from '../src/agents/screen-prompt.js';

// Screens as Claude Code draws them in an 80x24 tmux pane.
const RULE = '─'.repeat(80);
const DASHES = '╌'.repeat(80);

const question = [
  '❯ Use the AskUserQuestion tool to ask me which color I prefer',
  '',
  RULE,
  ' ☐ Color',
  '',
  'Which color do you prefer?',
  '',
  '❯ 1. Red',
  '     A warm, bold color associated with energy and passion.',
  '  2. Green',
  '     A natural, calming color associated with growth and balance.',
  '  3. Blue',
  '     A cool, steady color associated with trust and calm.',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '',
].join('\n');

const permission = [
  '⏺ Bash(rm notes.txt)',
  '  ⎿  Waiting…',
  '',
  RULE,
  ' Bash command',
  ' Delete notes.txt',
  DASHES,
  ' rm notes.txt',
  DASHES,
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to',
  '      /home/dev/projects/demo from this project',
  '   3. No',
  '',
  ' Esc to cancel · Tab to amend',
  '',
].join('\n');

// The plan fills the screen, so the rule above it has scrolled away; the plan's own steps are numbered too.
const plan = [
  ' Here is Claude\'s plan:',
  DASHES,
  ' Add a line to notes.txt',
  '',
  ' 1. Append the line: printf \'bye\\n\' >> notes.txt (this creates the file if it',
  '    doesn\'t exist).',
  ' 2. Check it worked: tail -n 1 notes.txt should print bye.',
  DASHES,
  '',
  RULE,
  ' Claude has written up a plan and is ready to execute. Would you like to',
  ' proceed?',
  '',
  ' ❯ 1. Yes, and use auto mode',
  '   2. Yes, manually approve edits',
  '   3. Tell Claude what to change',
  '      shift+tab to approve with this feedback',
  '',
  ' ctrl+g to edit in VS Code ·',
  ' ~/.claude/plans/plan-a-line.md',
].join('\n');

test('a question Claude asks you: its text, every option, and which one is selected', () => {
  const prompt = parseScreenPrompt(question);
  assert.equal(prompt.question, 'Which color do you prefer?');
  assert.deepEqual(prompt.options.map((o) => `${o.number}. ${o.label}`), [
    '1. Red', '2. Green', '3. Blue', '4. Type something.', '5. Chat about this',
  ]);
  assert.deepEqual(prompt.options.filter((o) => o.selected).map((o) => o.label), ['Red']);
  assert.ok(prompt.text.startsWith(' ☐ Color\n\nWhich color do you prefer?\n\n❯ 1. Red\n     A warm, bold color'));
  assert.ok(!prompt.text.includes('─'), 'rules are drawing, not text');
  assert.ok(!prompt.text.includes('Esc to cancel'), 'keyboard hints are for the terminal');
});

test('a permission prompt keeps the command, and wrapped options stay with their option', () => {
  const prompt = parseScreenPrompt(permission);
  assert.equal(prompt.question, 'Do you want to proceed?');
  assert.deepEqual(prompt.options.map((o) => o.label), ['Yes', 'Yes, and always allow access to', 'No']);
  assert.equal(prompt.text, [
    'Bash command',
    'Delete notes.txt',
    '',
    'rm notes.txt',
    '',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. Yes, and always allow access to',
    '     /home/dev/projects/demo from this project',
    '  3. No',
  ].join('\n'));
});

test('a plan approval: the question wrapped over two lines, not the numbered steps of the plan above it', () => {
  const prompt = parseScreenPrompt(plan);
  assert.equal(prompt.question, 'Claude has written up a plan and is ready to execute. Would you like to proceed?');
  assert.deepEqual(prompt.options.map((o) => o.label), [
    'Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change',
  ]);
  assert.ok(!prompt.text.includes('printf'));
});

test('a dialog taller than the screen runs from the top of the screen', () => {
  const prompt = parseScreenPrompt(['Pick a branch to base it on', '❯ 1. main', '  2. develop', 'Esc to cancel'].join('\n'));
  assert.equal(prompt.question, 'Pick a branch to base it on');
  assert.equal(prompt.options.length, 2);
});

test('a screen with no numbered options has no dialog', () => {
  assert.equal(parseScreenPrompt('❯ \n\n  ⏵⏵ auto mode on (shift+tab to cycle)'), null);
  assert.equal(parseScreenPrompt(''), null);
  assert.equal(parseScreenPrompt(null), null);
});
