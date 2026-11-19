import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TASK_ID } from './task-hub.js';

/*
 * Who may use switchyard's MCP tools: a Claude started as a task's lead.
 * Its token is the task's id signed with a secret only this machine's
 * switchyard knows (kept in a file readable by you alone), so it names the
 * one task whose workers it may start, survives a restart, and needs no
 * list of tokens kept anywhere. The token reaches Claude in a config file,
 * also readable by you alone, never on a command line where the screen or
 * ps would show it. A settings file beside it has Claude ask you before it
 * uses switchyard's tools. Like the rest of switchyard, this keeps out web
 * pages and other users, not programs running as you: those can read the
 * secret, as they can your files.
 */

const SECRET_FILE = 'mcp-secret';
const LEADS_DIR = 'leads';
const SECRET_BYTES = 32;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const BEARER = /^Bearer (\S+)$/;

/**
 * The settings a lead's Claude is started with: ask you before using any of switchyard's tools. An ask rule
 * holds in every permission mode, auto mode included, which would otherwise run them by itself.
 */
export const LEAD_SETTINGS = Object.freeze({ permissions: Object.freeze({ ask: Object.freeze(['mcp__switchyard']) }) });

/** The MCP config a lead's Claude is started with: this switchyard's /mcp, with the lead's token. */
export function mcpConfigFor({ port, token }) {
  return {
    mcpServers: {
      switchyard: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
    },
  };
}

const sign = (secret, id) => createHmac('sha256', secret).update(id).digest('hex');
const asJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Write `text` to `file` in `dir`, readable by you alone, whole or not at all. */
async function writePrivate(dir, file, text) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
}

/**
 * @param {{ dir: string, port: number }} deps `dir` is switchyard's own folder (see json-store.js).
 */
export function createLeadAccess({ dir, port }) {
  let secretLoad = null;

  /** The signing secret: read from its file, or made and saved the first time (when there's no file). */
  async function loadSecret() {
    const file = join(dir, SECRET_FILE);
    const saved = await readFile(file, 'utf8').then((text) => text.trim(), (error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (saved !== null) {
      // Replacing it would sign every running lead out; leave it for you to look at.
      if (!SECRET_PATTERN.test(saved)) throw new Error(`${file} is damaged; delete it to make a new one (running leads will need starting again)`);
      return saved;
    }
    const made = randomBytes(SECRET_BYTES).toString('hex');
    await writePrivate(dir, file, `${made}\n`);
    return made;
  }

  /** Loaded once, so two first calls agree on it; a failed load is tried again next time. */
  const getSecret = () => {
    secretLoad ??= loadSecret().catch((error) => {
      secretLoad = null;
      throw error;
    });
    return secretLoad;
  };

  async function tokenFor(id) {
    if (!TASK_ID.pattern.test(id)) throw new Error('A lead token is for a task id');
    return `${id}.${sign(await getSecret(), id)}`;
  }

  return {
    tokenFor,

    /** The task id an Authorization header's token leads, or null when it's missing or not one this switchyard signed. */
    async leadFrom(header) {
      const [, token] = BEARER.exec(header ?? '') ?? [];
      const [id, signature, ...rest] = (token ?? '').split('.');
      if (!id || !signature || rest.length > 0 || !TASK_ID.pattern.test(id)) return null;
      const expected = Buffer.from(sign(await getSecret(), id));
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
    },

    /**
     * Write the files a lead's Claude starts with: its MCP config (with its token) and its settings.
     * Resolves to their paths, for `claude --mcp-config` and `--settings`.
     */
    async writeConfig(id) {
      if (!TASK_ID.pattern.test(id)) throw new Error('A lead config is for a task id');
      const leads = join(dir, LEADS_DIR);
      const mcpConfig = join(leads, `${id}.mcp.json`);
      const settings = join(leads, `${id}.settings.json`);
      await writePrivate(leads, mcpConfig, asJson(mcpConfigFor({ port, token: await tokenFor(id) })));
      await writePrivate(leads, settings, asJson(LEAD_SETTINGS));
      return { mcpConfig, settings };
    },
  };
}
