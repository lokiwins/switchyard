/*
 * Line diffs for reviewing an edit before allowing it: hunks of changed lines
 * with a little context and real line numbers, like `git diff`.
 */

const CONTEXT_LINES = 3;
// Lines left to compare after trimming the common start and end, as a table
// of old × new cells. Past this, the middle is shown as replaced outright.
const MAX_CELLS = 4_000_000;

const splitLines = (text) => {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalized === '' ? [] : normalized.split('\n');
};

/** The ops turning `a` into `b` (' ' kept, '-' removed, '+' added), by longest common subsequence. */
function alignLines(a, b) {
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push(' ');
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      ops.push('-');
      i += 1;
    } else {
      ops.push('+');
      j += 1;
    }
  }
  return [...ops, ...Array(a.length - i).fill('-'), ...Array(b.length - j).fill('+')];
}

/** Every line of the comparison, numbered in the old and new text. */
function numberLines(oldLines, newLines, ops) {
  let o = 0;
  let n = 0;
  return ops.map((type) => {
    if (type === ' ') {
      o += 1;
      n += 1;
      return { type, text: oldLines[o - 1], old: o, new: n };
    }
    if (type === '-') {
      o += 1;
      return { type, text: oldLines[o - 1], old: o, new: null };
    }
    n += 1;
    return { type, text: newLines[n - 1], old: null, new: n };
  });
}

/** Changed lines with `context` unchanged lines around them; changes closer than that share a hunk. */
function groupHunks(numbered, context) {
  const changed = numbered.flatMap((line, index) => (line.type === ' ' ? [] : [index]));
  const hunks = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(numbered.length - 1, index + context);
    const last = hunks.at(-1);
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  return hunks.map(({ start, end }) => {
    const slice = numbered.slice(start, end + 1);
    const first = (key) => slice.find((line) => line[key] !== null)?.[key] ?? null;
    return { oldStart: first('old'), newStart: first('new'), lines: slice };
  });
}

/**
 * The difference between two texts as hunks, with counts of added and
 * removed lines. `approximate` when the texts were too big to align line by
 * line and the differing middle is shown as replaced outright.
 */
export function diffLines(before, after, { context = CONTEXT_LINES, maxCells = MAX_CELLS } = {}) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const approximate = oldMiddle.length * newMiddle.length > maxCells;
  const middle = approximate
    ? [...Array(oldMiddle.length).fill('-'), ...Array(newMiddle.length).fill('+')]
    : alignLines(oldMiddle, newMiddle);
  const ops = [...Array(prefix).fill(' '), ...middle, ...Array(suffix).fill(' ')];
  return {
    hunks: groupHunks(numberLines(oldLines, newLines, ops), context),
    added: middle.filter((op) => op === '+').length,
    removed: middle.filter((op) => op === '-').length,
    approximate,
  };
}
