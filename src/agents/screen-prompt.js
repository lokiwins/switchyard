/*
 * What a waiting Claude session is asking, read off its terminal screen.
 * The registry only says a session is waiting, and a question or plan isn't
 * in the transcript until it's answered, but Claude Code draws every such
 * dialog the same way: a full-width rule, the question, then numbered
 * options, then a line of keyboard hints. A dialog taller than the screen
 * has lost its top, so the text runs from the top of the screen instead.
 */

// A full-width rule: the line Claude Code draws above a dialog (and between its option groups).
const RULE = /^\s*─{20,}\s*$/;
// The dashed lines around a command or plan inside a dialog.
const DASHES = /^\s*╌{20,}\s*$/;
const OPTION = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const HINTS = /\b(Esc to cancel|Enter to (select|confirm)|ctrl\+g to edit)\b/i;

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

/** The paragraph just above the options, joined back into one line: the question itself. */
function questionOf(lines) {
  const paragraph = [];
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i -= 1;
  for (; i >= 0 && lines[i].trim() !== ''; i -= 1) paragraph.unshift(lines[i].trim());
  return paragraph.join(' ') || null;
}

/**
 * The dialog on a captured screen, or null when there isn't one: its whole
 * text, the question and the options (the first line of each).
 */
export function parseScreenPrompt(screen) {
  const lines = String(screen ?? '').split('\n').map((line) => line.trimEnd());
  const first = lines.findLastIndex((line) => OPTION.exec(line)?.[2] === '1');
  if (first < 0) return null;
  const top = lines.slice(0, first).findLastIndex((line) => RULE.test(line)) + 1;
  const hints = lines.findIndex((line, i) => i > first && HINTS.test(line));
  const body = tidy(lines.slice(top, hints < 0 ? lines.length : hints));
  const start = body.findIndex((line) => OPTION.exec(line)?.[2] === '1');
  const options = body.slice(start).flatMap((line) => {
    const match = OPTION.exec(line);
    return match ? [{ number: Number(match[2]), label: match[3], selected: Boolean(match[1]) }] : [];
  });
  return { question: questionOf(body.slice(0, start)), options, text: body.join('\n') };
}
