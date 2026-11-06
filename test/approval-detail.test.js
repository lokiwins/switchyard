import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdits, describeApproval, readTextFile } from '../src/approval-detail.js';

/** A fake file system: path -> contents (string or Buffer), or { dir: true } / { size } entries. */
function files(entries) {
  const get = (path) => {
    if (!(path in entries)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return entries[path];
  };
  return {
    statFile: async (path) => {
      const entry = get(path);
      const size = entry.size ?? (entry.dir ? 0 : Buffer.byteLength(entry));
      return { isFile: () => !entry.dir, size };
    },
    read: async (path) => Buffer.from(get(path)),
  };
}

const FILE = '/w/my-repo/src/app.js';
const source = ['import a from "a";', '', 'function greet() {', '  return "hello";', '}', '', 'export { greet };'].join('\n');

test('an Edit shows the diff it would make to the file, with real line numbers', async () => {
  const detail = await describeApproval('Edit', { file_path: FILE, old_string: 'return "hello"', new_string: 'return "hi"' }, files({ [FILE]: source }));
  assert.equal(detail.kind, 'diff');
  assert.equal(detail.note, null);
  assert.equal(detail.diff.added, 1);
  assert.deepEqual(detail.diff.hunks[0].lines.find((l) => l.type === '-'), { type: '-', text: '  return "hello";', old: 4, new: null });
});

test('a MultiEdit applies its edits in order', async () => {
  const detail = await describeApproval('MultiEdit', {
    file_path: FILE,
    edits: [{ old_string: 'greet', new_string: 'welcome', replace_all: true }, { old_string: '"hello"', new_string: '"hey"' }],
  }, files({ [FILE]: source }));
  const added = detail.diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === '+').map((l) => l.text);
  assert.deepEqual(added, ['function welcome() {', '  return "hey";', 'export { welcome };']);
});

test('an Edit whose text no longer matches shows just the old and new text, and says why', async () => {
  const detail = await describeApproval('Edit', { file_path: FILE, old_string: 'missing', new_string: 'x' }, files({ [FILE]: source }));
  assert.match(detail.note, /isn't in the file/);
  assert.deepEqual(detail.diff.hunks[0].lines.map((l) => l.type + l.text), ['-missing', '+x']);
});

test('a Write diffs against the existing file, or shows a new file as added', async () => {
  const changed = await describeApproval('Write', { file_path: FILE, content: source.replace('hello', 'hi') }, files({ [FILE]: source }));
  assert.equal(changed.isNewFile, false);
  assert.equal(changed.diff.removed, 1);
  const created = await describeApproval('Write', { file_path: '/w/my-repo/NOTES.md', content: '# Notes\n\n- one' }, files({}));
  assert.equal(created.isNewFile, true);
  assert.equal(created.diff.added, 3);
  assert.equal(created.markdown, '# Notes\n\n- one');
});

test('only Markdown files get a rendered preview', async () => {
  const detail = await describeApproval('Write', { file_path: FILE, content: '# not markdown' }, files({}));
  assert.equal(detail.markdown, null);
});

test('files that cannot be shown are not read, and the change is shown on its own', async () => {
  const big = await describeApproval('Write', { file_path: FILE, content: 'new' }, files({ [FILE]: { size: 5 * 1024 * 1024 } }));
  assert.match(big.note, /larger than 1 MB/);
  assert.equal(big.diff.added, 1);
  assert.equal((await readTextFile('/w/bin', files({ '/w/bin': Buffer.from([1, 0, 2]) }))).reason, "it's a binary file");
  assert.equal((await readTextFile('/w/dir', files({ '/w/dir': { dir: true } }))).reason, "it isn't a regular file");
  assert.equal((await readTextFile('relative/path', files({}))).reason, "the path isn't absolute");
});

test('Bash shows the whole command, and other tools their input', async () => {
  assert.deepEqual(await describeApproval('Bash', { command: 'rm -rf build && make' }), { kind: 'command', command: 'rm -rf build && make' });
  assert.deepEqual(await describeApproval('WebFetch', { url: 'https://example.com' }), { kind: 'input', text: '{\n  "url": "https://example.com"\n}' });
});

test('applyEdits keeps $ patterns in the new text literal', () => {
  assert.equal(applyEdits('price', [{ old_string: 'price', new_string: '$& $1' }]), '$& $1');
  assert.equal(applyEdits('a', [{ old_string: 'b', new_string: 'c' }]), null);
});
