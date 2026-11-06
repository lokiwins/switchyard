/*
 * A branch name made from a task, for New task when you don't give one:
 * the first few words that carry meaning, lowercase, joined with hyphens.
 * Shared by the form (to show what it will create) and the server (which
 * decides, adding -2, -3… when the name is taken).
 */

// Words that make a prompt read naturally but say nothing in a branch name.
const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'then', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by',
  'from', 'into', 'about', 'as', 'is', 'are', 'be', 'it', 'its', 'this', 'that', 'these', 'those',
  'please', 'can', 'could', 'would', 'should', 'you', 'we', 'i', 'me', 'my', 'our', 'your', 'just', 'some',
]);
const MAX_WORDS = 5;
const MAX_LENGTH = 40;
// For a task with no letters or digits to name it by.
const FALLBACK = 'task';

export function branchFromTask(task) {
  const words = String(task ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const meaningful = words.filter((word) => !FILLER.has(word));
  const chosen = (meaningful.length > 0 ? meaningful : words).slice(0, MAX_WORDS);
  let name = '';
  for (const word of chosen) {
    const next = name ? `${name}-${word}` : word;
    if (next.length > MAX_LENGTH) break;
    name = next;
  }
  return name || chosen[0]?.slice(0, MAX_LENGTH) || FALLBACK;
}
