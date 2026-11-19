import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { ActionError } from './errors.js';
import { readJsonBody } from './http-body.js';

/*
 * switchyard's MCP server, at /mcp, for a Claude started as a task's lead
 * (see lead-access.js and lead-tools.js). Only that Claude gets in: it
 * sends its lead token, and a browser (anything sending Origin) is turned
 * away, so no web page can reach it, token or not. Stateless: each request
 * gets its own server, bound to the lead its token names.
 */

const VERSION = '1';
// Tool calls are a title and some notes; anything much bigger isn't one.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TITLE = 200;
const MAX_NOTES = 10_000;
// As long as a reply typed on the dashboard.
const MAX_MESSAGE = 2000;

const START_WORKER = {
  title: 'Start a worker',
  description: 'Hand part of your task to a worker: another Claude Code session, started on a subtask of your task, in its own worktree on '
    + 'its own branch (branched from your branch when it is in your repo). Say what it should do in the title and notes, as you would brief a '
    + 'colleague: the worker sees only those. Its permission prompts go to the user, not to you. When it is done, merge its branch into yours.',
  inputSchema: z.object({
    title: z.string().trim().min(1).max(MAX_TITLE).describe('What the worker should do, in one line'),
    notes: z.string().max(MAX_NOTES).optional().describe('More detail: what to change, what not to touch, how to know it is done'),
    repo: z.string().max(500).optional().describe('The repository to work in, by name; leave out for the one you are working in'),
  }),
};

const LIST_WORKERS = {
  title: 'List workers',
  description: 'Your workers (the subtasks of your task): each one\'s state (not started, working, idle, needs you, no session, done, dropped), '
    + 'and its worktree, branch and sessions. "needs you" means it waits on the user (a permission prompt, say), not on you.',
};

const WORKER_ID = z.string().regex(/^sy-[a-z0-9]{6}$/).describe('The worker\'s id, from list_workers or start_worker');

const WORKER_STATUS = {
  title: 'Worker status',
  description: 'One worker in detail: its state; each session\'s last reply and current activity; its commits not on your branch, '
    + 'what they change, and what is not committed yet; and its check results. Use it to decide whether a worker is done, stuck or needs a nudge.',
  inputSchema: z.object({ id: WORKER_ID }),
};

const MESSAGE_WORKER = {
  title: 'Message a worker',
  description: 'Type a message into a worker\'s running session, as if the user replied there: one line of plain text. If the worker is busy, '
    + 'it reads it when its turn ends. Refused while the worker shows a question or permission prompt: those are the user\'s to answer.',
  inputSchema: z.object({ id: WORKER_ID, text: z.string().trim().min(1).max(MAX_MESSAGE).describe('The message, one line') }),
};

const END_WORKER = {
  title: 'End a worker',
  description: 'End a worker\'s running session(s). Its worktree, branch and subtask stay, so you can still merge its work; '
    + 'the user closes the subtask from the dashboard.',
  inputSchema: z.object({ id: WORKER_ID }),
};

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/** A tool's answer, or its refusal in words for the lead to read. */
async function answer(work) {
  try {
    return text(await work());
  } catch (error) {
    const message = error instanceof ActionError ? error.message : `switchyard could not do that: ${error.message}`;
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

function serverFor(tools) {
  const server = new McpServer({ name: 'switchyard', version: VERSION });
  server.registerTool('start_worker', START_WORKER, (args) => answer(() => tools.startWorker(args)));
  server.registerTool('list_workers', LIST_WORKERS, () => answer(() => tools.listWorkers()));
  server.registerTool('worker_status', WORKER_STATUS, (args) => answer(() => tools.workerStatus(args)));
  server.registerTool('message_worker', MESSAGE_WORKER, (args) => answer(() => tools.messageWorker(args)));
  server.registerTool('end_worker', END_WORKER, (args) => answer(() => tools.endWorker(args)));
  return server;
}

function refuse(res, status, error) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: error }, id: null }));
}

/**
 * @param {{ leadFrom: (authorization?: string) => Promise<string|null>,
 *   toolsFor: (leadId: string) => { startWorker, listWorkers, workerStatus, messageWorker, endWorker } }} deps
 *   `toolsFor(lead)` gives the lead's tools (see lead-tools.js), each resolving to what the lead is told.
 */
export function createMcpEndpoint({ leadFrom, toolsFor }) {
  return {
    async handle(req, res) {
      if (req.headers.origin !== undefined) return refuse(res, 403, 'Browsers may not use switchyard\'s MCP server');
      const lead = await leadFrom(req.headers.authorization);
      if (!lead) return refuse(res, 401, 'A lead token is needed');
      // Stateless, so there's no stream to open (GET) or session to end (DELETE).
      if (req.method !== 'POST') return refuse(res, 405, 'Method not allowed');
      let body;
      try {
        body = await readJsonBody(req, MAX_BODY_BYTES);
      } catch (error) {
        return refuse(res, error.status ?? 400, error.message);
      }
      const server = serverFor(toolsFor(lead));
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        if (!res.headersSent) refuse(res, 500, `switchyard's MCP server failed: ${error.message}`);
      }
      return undefined;
    },
  };
}
