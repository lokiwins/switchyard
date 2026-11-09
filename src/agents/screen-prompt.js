/*
 * What a waiting Claude session is asking, read off its terminal screen.
 * The registry only says a session is waiting, and a question or plan isn't
 * in the transcript until it's answered, but Claude Code draws every such
 * dialog the same way: a full-width rule, the question, then numbered
 * options, then a line of keyboard hints. A dialog taller than the screen
 * has lost its top, so the text runs from the top of the screen instead.
 *
 * Pressing an option's number answers it, with three kinds of exception the
 * page needs to know about: some options open a text field for your own
 * answer, a question with several parts has tabs (→ goes on to the next, and
 * the last one submits), and a multiple-choice question's number keys tick
 * boxes. A plan approval names the file the plan is in. A permission prompt
 * whose hints offer "Tab to amend" lets its Yes and No carry an instruction
 * for Claude: Tab on the selected one turns it into a text field.
 *
 * The screen may be captured with its colours, which are read past except in
 * a tab bar, where the highlighted tab is the one showing.
 */

// A full-width rule: the line Claude Code draws above a dialog (and between its option groups).
const RULE = /^\s*─{20,}\s*$/;
// The dashed lines around a command or plan inside a dialog.
const DASHES = /^\s*╌{20,}\s*$/;
const OPTION = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const HINTS = /\b(Esc to cancel|Enter to (select|confirm)|ctrl\+g to edit)\b/i;
// A tick box before a multiple-choice option's label.
const CHECKBOX = /^\[(.)\]\s+/;
// Options that turn into a text field when chosen.
const TAKES_TEXT = /^(Type something\.?|Tell Claude what to change)$/;
// The tab bar of a question in several parts: "←  ☐ Fruits  ✔ Submit  →".
const TABS = /^\s*←.*→\s*$/;
// Colours and styles, as tmux's capture-pane -e writes them.
const SGR = /\x1b\[[0-9;:]*m/g;
// A background colour or reverse video, then the text it's behind: a highlighted tab.
const HIGHLIGHT = /\x1b\[(?:[0-9;:]*;)?(?:48;[0-9;:]+|7)m([^\x1b]*)/;
const TAB_TO_AMEND = /\bTab to amend\b/;
const AMENDABLE = new Set(['Yes', 'No']);
// Plans are files in ~/.claude/plans; only a plain file name there is taken.
const PLAN_FILE = /~\/\.claude\/plans\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.md)(?=\s|$)/;

const isSeparator = (line) => RULE.test(line) || DASHES.test(line);

/** Separators become breaks between paragraphs, and runs of blank lines one blank line. */
function tidy(lines) {
  const kept = lines.map((line) => (isSeparator(line) ? '' : line))
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''));
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  const indent = Math.min(...kept.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length));
  return kept.map((line) => line.slice(indent));
}

/** The paragraph just above the options (below any tab bar), joined back into one line: the question itself. */
function questionOf(lines) {
  const paragraph = [];
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i -= 1;
  for (; i >= 0 && lines[i].trim() !== '' && !TABS.test(lines[i]); i -= 1) paragraph.unshift(lines[i].trim());
  return paragraph.join(' ') || null;
}

/** One numbered option: its label without any tick box, and whether the box is ticked (undefined without one). */
function optionOf([, selected, number, rest], { amendable }) {
  const box = CHECKBOX.exec(rest);
  const label = box ? rest.slice(box[0].length) : rest;
  return {
    number: Number(number),
    label,
    selected: Boolean(selected),
    checked: box ? box[1].trim() !== '' : undefined,
    takesText: TAKES_TEXT.test(label),
    amends: amendable && AMENDABLE.has(label),
  };
}

/** Whether a tab bar, as captured with colours, has its last tab highlighted. False when no tab is. */
function onLastTab(rawBar, bar) {
  const highlighted = HIGHLIGHT.exec(rawBar)?.[1].trim();
  return Boolean(highlighted) && highlighted === bar.replace(/[←→]/g, '').trim().split(/\s{2,}/).at(-1);
}

/**
 * The dialog on a captured screen, or null when there isn't one: its whole
 * text, the question, the options (the first line of each), whether it has
 * tabs and is on the last one, and the plan's file name for a plan approval.
 */
export function parseScreenPrompt(screen) {
  const raw = String(screen ?? '').split('\n');
  const lines = raw.map((line) => line.replace(SGR, '').trimEnd());
  const first = lines.findLastIndex((line) => OPTION.exec(line)?.[2] === '1');
  if (first < 0) return null;
  const top = lines.slice(0, first).findLastIndex((line) => RULE.test(line)) + 1;
  const hints = lines.findIndex((line, i) => i > first && HINTS.test(line));
  const body = tidy(lines.slice(top, hints < 0 ? lines.length : hints));
  const start = body.findIndex((line) => OPTION.exec(line)?.[2] === '1');
  const amendable = hints >= 0 && TAB_TO_AMEND.test(lines[hints]);
  const options = body.slice(start).flatMap((line) => {
    const match = OPTION.exec(line);
    return match ? [optionOf(match, { amendable })] : [];
  });
  const bar = lines.findIndex((line, i) => i >= top && i < first && TABS.test(line));
  return {
    question: questionOf(body.slice(0, start)),
    options,
    text: body.join('\n'),
    tabs: bar >= 0,
    lastTab: bar >= 0 && onLastTab(raw[bar], lines[bar]),
    planFile: PLAN_FILE.exec(lines.slice(first).join('\n'))?.[1] ?? null,
  };
}
