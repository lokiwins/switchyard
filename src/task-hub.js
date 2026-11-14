import { randomInt } from 'node:crypto';
import { ActionError } from './errors.js';
import { createJsonFile, defaultStoreDir } from './json-store.js';
import { hasControlCharacters } from './tmux.js';

/*
 * Your tasks on the Tasks page: switchyard's own, not a tracker's. Each has
 * a title, notes (what Claude is told when you start it), an optional due
 * day and links to its tickets in any tracker. They're kept in
 * ~/.config/switchyard/tasks.json, readable only by you. What a task's work
 * is doing (its worktree, PR and Claude session) isn't stored: it's found
 * from branches that name the task, or from where it was saved as being when
 * it was made from a session (see task-links.js).
 */

const FILE = 'tasks.json';
const MAX_TITLE = 200;
const MAX_NOTES = 10_000;
const MAX_LINKS = 20;
const MAX_LINK_LENGTH = 1000;
const CLOSED_AS = new Set(['done', 'dropped']);
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A task's id: "sy-" and six letters or digits, short enough to put in a branch name, which then links the two. */
export const TASK_ID = {
  pattern: /^sy-[a-z0-9]{6}$/,
  generate: () => `sy-${Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')}`,
};

const bad = (message) => new ActionError(400, message);

function parseTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > MAX_TITLE || hasControlCharacters(title)) {
    throw bad(`A task needs a title: one line, up to ${MAX_TITLE} characters`);
  }
  return title;
}

function parseNotes(value) {
  const notes = typeof value === 'string' ? value.trim() : '';
  // Line breaks are fine in notes; other control characters aren't.
  if (notes.length > MAX_NOTES || hasControlCharacters(notes.replace(/\r?\n/g, ' '))) {
    throw bad(`The notes can be up to ${MAX_NOTES} characters of text`);
  }
  return notes;
}

/** "2026-11-20" for a real day, or null. */
function parseDueOn(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = typeof value === 'string' ? DAY.exec(value) : null;
  const [, year, month, day] = match ?? [];
  const date = match && new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (!date || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw bad('The due date must be a date like 2026-11-20');
  }
  return value;
}

function parseLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bad(`"${String(value).slice(0, 60)}" is not a link`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || value.length > MAX_LINK_LENGTH) throw bad('Each link must be an http(s) URL');
  return value;
}

function parseLinks(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad('The links must be a list');
  const links = value.map((link) => (typeof link === 'string' ? link.trim() : '')).filter(Boolean);
  if (links.length > MAX_LINKS) throw bad(`A task can have up to ${MAX_LINKS} links`);
  return links.map(parseLink);
}

const PARSERS = { title: parseTitle, notes: parseNotes, dueOn: parseDueOn, links: parseLinks };

/** The fields of a task from the page, checked. With `partial`, only the ones present (for an update). */
export function parseTaskFields(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw bad('Invalid request');
  return Object.fromEntries(Object.entries(PARSERS)
    .filter(([field]) => !partial || field in body)
    .map(([field, parse]) => [field, parse(body[field])]));
}

const isTask = (task) => task && typeof task === 'object' && TASK_ID.pattern.test(task.id) && typeof task.title === 'string';

/**
 * @param {{ file?: { read, write }, now?: () => number, newId?: () => string }} deps
 */
export function createTaskHub({ file = createJsonFile(defaultStoreDir(), FILE), now = Date.now, newId = TASK_ID.generate } = {}) {
  // Changes run one at a time, each reading what the one before it wrote.
  let queue = Promise.resolve();

  async function read() {
    const data = await file.read();
    return Array.isArray(data.tasks) ? data.tasks.filter(isTask) : [];
  }

  /** Apply `change` to the tasks and save them; resolves to what `change` returns. */
  function change(apply) {
    const run = queue.then(async () => {
      const tasks = await read();
      const { tasks: next, result } = apply(tasks);
      await file.write({ tasks: next });
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  /** Change one task with `edit`; 404 when it isn't there. */
  function edit(body, update) {
    const id = body?.id;
    return change((tasks) => {
      const found = tasks.find((t) => t.id === id);
      if (!found) throw new ActionError(404, 'That task is not there any more');
      const updated = { ...found, ...update(found), updatedAt: now() };
      return { tasks: tasks.map((t) => (t.id === id ? updated : t)), result: updated };
    });
  }

  return {
    /** Every task, newest first. */
    list: () => queue.then(read),

    /**
     * A new task. `attached` says where its work already is, when it's made
     * from a session: its repo and branch, or one session (see task-sources.js).
     * Only the server sets it, never what the page sends.
     */
    async create(body, { attached = [] } = {}) {
      const fields = parseTaskFields(body);
      return change((tasks) => {
        const ids = new Set(tasks.map((t) => t.id));
        let id = newId();
        while (ids.has(id)) id = newId();
        const time = now();
        const task = {
          id, ...fields, ...(attached.length > 0 ? { attached } : {}), createdAt: time, updatedAt: time, closedAs: null, closedAt: null,
        };
        return { tasks: [task, ...tasks], result: task };
      });
    },

    async update(body) {
      const fields = parseTaskFields(body, { partial: true });
      return edit(body, () => fields);
    },

    /** Mark it done or dropped, when there's no merged PR to say so. */
    async close(body) {
      if (!CLOSED_AS.has(body?.as)) throw bad('A task is closed as done or dropped');
      return edit(body, () => ({ closedAs: body.as, closedAt: now() }));
    },

    reopen: (body) => edit(body, () => ({ closedAs: null, closedAt: null })),

    async remove(body) {
      const id = body?.id;
      return change((tasks) => {
        if (!tasks.some((t) => t.id === id)) throw new ActionError(404, 'That task is not there any more');
        return { tasks: tasks.filter((t) => t.id !== id), result: { removed: id } };
      });
    },
  };
}
