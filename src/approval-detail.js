import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { diffLines } from './diff.js';

/*
 * What a waiting permission prompt would do, in full, for reviewing it before
 * allowing it: the diff an Edit or Write would make to the file as it is now,
 * the whole command for Bash, and the tool's input for anything else.
 */

// Bigger files aren't read; the change is shown without the rest of the file.
const MAX_FILE_BYTES = 1024 * 1024;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

/** { exists, text } for a file the tool would change; text is null (with a reason) when it can't be shown. */
export async function readTextFile(path, { statFile = stat, read = readFile } = {}) {
  if (!isAbsolute(path)) return { exists: false, text: null, reason: "the path isn't absolute" };
  let info;
  try {
    info = await statFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, text: '' };
    return { exists: true, text: null, reason: "the file can't be read" };
  }
  if (!info.isFile()) return { exists: true, text: null, reason: "it isn't a regular file" };
  if (info.size > MAX_FILE_BYTES) return { exists: true, text: null, reason: 'the file is larger than 1 MB' };
  const bytes = await read(path);
  if (bytes.includes(0)) return { exists: true, text: null, reason: "it's a binary file" };
  return { exists: true, text: bytes.toString('utf8') };
}

/** The text after Claude's edits, applied as Claude Code applies them, or null if one no longer matches. */
export function applyEdits(text, edits) {
  let result = text;
  for (const edit of edits) {
    if (typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string' || !result.includes(edit.old_string)) return null;
    // A replacer function, so "$&" and the like in the new text stay literal.
    result = edit.replace_all
      ? result.split(edit.old_string).join(edit.new_string)
      : result.replace(edit.old_string, () => edit.new_string);
  }
  return result;
}

const editsOf = (toolName, input) => (toolName === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [input]);
const isMarkdown = (path) => MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase());

function diffDetail(path, before, after, { isNewFile = false, note = null } = {}) {
  return {
    kind: 'diff',
    path,
    isNewFile,
    note,
    diff: diffLines(before, after),
    // The whole new text, for a rendered preview of Markdown.
    markdown: isMarkdown(path) && note === null ? after : null,
  };
}

async function editDetail(toolName, input, files) {
  const path = input.file_path;
  const edits = editsOf(toolName, input);
  const file = await readTextFile(path, files);
  const after = file.text === null ? null : applyEdits(file.text, edits);
  if (after !== null) return diffDetail(path, file.text, after);
  // Without the file, show just the text being replaced and what replaces it.
  const reason = file.text === null ? file.reason : "the text to replace isn't in the file as it is now";
  const join = (key) => edits.map((edit) => String(edit[key] ?? '')).join('\n');
  return diffDetail(path, join('old_string'), join('new_string'), { note: `Shown without the rest of the file: ${reason}.` });
}

async function writeDetail(input, files) {
  const path = input.file_path;
  const content = String(input.content ?? '');
  const file = await readTextFile(path, files);
  if (file.text === null) return diffDetail(path, '', content, { note: `Shown as new text; the current file isn't compared: ${file.reason}.` });
  return diffDetail(path, file.text, content, { isNewFile: !file.exists });
}

/** Everything a prompt would do, for the review pane. `files` replaces the file system in tests. */
export async function describeApproval(toolName, input, files = {}) {
  if ((toolName === 'Edit' || toolName === 'MultiEdit') && typeof input.file_path === 'string') return editDetail(toolName, input, files);
  if (toolName === 'Write' && typeof input.file_path === 'string') return writeDetail(input, files);
  if (toolName === 'Bash' && typeof input.command === 'string') return { kind: 'command', command: input.command };
  return { kind: 'input', text: JSON.stringify(input, null, 2) };
}
