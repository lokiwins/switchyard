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

const multiSelect = [
  RULE,
  '←  ☒ Fruits  ✔ Submit  →',
  '',
  'Which fruits do you like?',
  '',
  '❯ 1. [✔] Apple',
  '         Apples',
  '  2. [ ] Pear',
  '         Pears',
  '  3. [ ] Type something',
  '     Submit',
  RULE,
  '  4. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

test('a question with tabs: boxes ticked or not, and a way on to the next tab', () => {
  const prompt = parseScreenPrompt(multiSelect);
  assert.equal(prompt.question, 'Which fruits do you like?');
  assert.deepEqual(prompt.options.map(({ label, checked }) => [label, checked]), [
    ['Apple', true], ['Pear', false], ['Type something', false], ['Chat about this', undefined],
  ]);
  assert.equal(prompt.tabs, true);
  assert.equal(parseScreenPrompt(question).tabs, false);
});

// The tab bar as captured with colours (capture-pane -e): the active tab has a background.
const ESC = '\x1b';
const ACTIVE = `${ESC}[38;5;16m${ESC}[48;5;153m`;
const PLAIN = `${ESC}[39m${ESC}[49m`;
const tabBar = (active) => ['☒ Fruit', '☒ Color', '✔ Submit']
  .map((tab) => (tab.endsWith(active) ? `${ACTIVE} ${tab} ${PLAIN}` : ` ${tab} `)).join('');
const tabbed = (active) => [RULE, `←  ${tabBar(active)}  →`, '', 'Ready to submit your answers?', '', '❯ 1. Submit answers', '  2. Cancel'].join('\n');

test('a question with tabs says whether its last tab is the one showing, read from the highlight', () => {
  assert.equal(parseScreenPrompt(tabbed('Submit')).lastTab, true);
  assert.equal(parseScreenPrompt(tabbed('Color')).lastTab, false);
  // Without colours the active tab can't be told, so it isn't taken to be the last.
  assert.equal(parseScreenPrompt(multiSelect).lastTab, false);
  assert.equal(parseScreenPrompt(question).lastTab, false);
});

test('colours are read past, not into the text', () => {
  const prompt = parseScreenPrompt(tabbed('Submit'));
  assert.equal(prompt.question, 'Ready to submit your answers?');
  assert.ok(!prompt.text.includes(ESC));
  assert.equal(parseScreenPrompt(question.replace('Which color', `${ESC}[1mWhich color${ESC}[22m`)).question, 'Which color do you prefer?');
});

test("a permission prompt's Yes and No can carry your own instruction when it offers Tab to amend", () => {
  const amends = (screen) => parseScreenPrompt(screen).options.filter((o) => o.amends).map((o) => o.label);
  assert.deepEqual(amends(permission), ['Yes', 'No']);
  assert.deepEqual(amends(permission.replace(' · Tab to amend', '')), []);
  assert.deepEqual(amends(question), []);
});

test('options that open a text field to type your own answer', () => {
  const takesText = (screen) => parseScreenPrompt(screen).options.filter((o) => o.takesText).map((o) => o.label);
  assert.deepEqual(takesText(question), ['Type something.']);
  assert.deepEqual(takesText(multiSelect), ['Type something']);
  assert.deepEqual(takesText(plan), ['Tell Claude what to change']);
  assert.deepEqual(takesText(permission), []);
});

test("a plan approval names the plan's file; other dialogs don't", () => {
  assert.equal(parseScreenPrompt(plan).planFile, 'plan-a-line.md');
  assert.equal(parseScreenPrompt(question).planFile, null);
  const mentionedEarlier = `Saved an old one to ~/.claude/plans/old-plan.md\n${plan}`;
  assert.equal(parseScreenPrompt(mentionedEarlier).planFile, 'plan-a-line.md', 'the dialog names its own plan last');
  const elsewhere = plan.replace('~/.claude/plans/plan-a-line.md', '~/.claude/plans/../secrets.md');
  assert.equal(parseScreenPrompt(elsewhere).planFile, null);
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
