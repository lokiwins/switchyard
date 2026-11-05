import { randomUUID } from 'node:crypto';
import { ActionError } from './errors.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
// Longer than this can't be shown in full on the page, and a cut-off command could hide its
// dangerous part, so such prompts are left to the terminal.
const MAX_SUMMARY = 2_000;
const MAX_PENDING = 100;
// Matches the hook's timeout in claude-hook.js: after that, Claude Code has stopped waiting.
const MAX_AGE_MS = 60 * 60_000;
const MAX_MESSAGE = 500;
// How long after a request a session snapshot must be taken before it can show the prompt was
// answered elsewhere: the registry's status changes a moment after Claude calls the hook.
const SETTLE_GRACE_MS = 3_000;
// Allowing a question would skip your answer, so those always stay in the terminal.
const PASS_THROUGH_TOOLS = new Set(['AskUserQuestion']);
const STOP_MESSAGE = 'The user declined this from switchyard and will say what to do next.';

/**
 * What a tool call would run or touch, in full. Claude's own description of a
 * command is left out: the model writes it, so it can't vouch for the command.
 */
export function describeTool(input) {
  const target = input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.query ?? null;
  return typeof target === 'string' ? target : JSON.stringify(input);
}

function parseHookInput(input) {
  const valid = input?.hook_event_name === 'PermissionRequest'
    && typeof input.session_id === 'string' && SESSION_ID_PATTERN.test(input.session_id)
    && typeof input.tool_name === 'string' && input.tool_name.length > 0 && input.tool_name.length <= 200
    && input.tool_input !== null && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input);
  if (!valid) throw new ActionError(400, 'Expected a PermissionRequest hook payload');
  return {
    sessionId: input.session_id,
    agentId: typeof input.agent_id === 'string' ? input.agent_id : null,
    toolName: input.tool_name,
    summary: describeTool(input.tool_input),
  };
}

function parseDecision(body) {
  const { id, behavior, message } = body ?? {};
  if (typeof id !== 'string' || (behavior !== 'allow' && behavior !== 'deny')) {
    throw new ActionError(400, 'Expected { id, behavior: "allow" | "deny" }');
  }
  if (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE || /[\0-\x1f]/.test(message))) {
    throw new ActionError(400, `A deny reason must be a single line of at most ${MAX_MESSAGE} characters`);
  }
  return { id, behavior, reason: message?.trim() || null };
}

/** A bare deny stops Claude to wait for you, like "No" in the terminal; a deny with a reason lets it adjust. */
function denial(reason) {
  return reason ? { behavior: 'deny', message: reason } : { behavior: 'deny', message: STOP_MESSAGE, interrupt: true };
}

const hookOutput = (decision) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });

/**
 * Permission prompts that can be answered from the page. Claude Code calls a
 * PermissionRequest hook and shows its own prompt at the same time; whichever
 * answers first wins. A terminal answer doesn't close the hook's connection,
 * so requests are also dropped once the session's status shows it moved on.
 */
export function createApprovalBroker({
  now = Date.now, newId = randomUUID, settleGraceMs = SETTLE_GRACE_MS, maxPending = MAX_PENDING,
} = {}) {
  const requests = new Map(); // id -> { view, resolve }

  function settle(id, output) {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    request.resolve(output);
  }

  /**
   * Hold a hook request until it's decided here or abandoned. Resolves to the
   * hook's response body, or null to leave the decision to the terminal.
   */
  function ask(input) {
    const fields = parseHookInput(input);
    if (PASS_THROUGH_TOOLS.has(fields.toolName) || fields.summary.length > MAX_SUMMARY) {
      return { decision: Promise.resolve(null), cancel: () => {} };
    }
    // Prompts in one conversation come one at a time, so an older one was answered in the terminal.
    for (const [id, { view }] of requests) {
      if (view.sessionId === fields.sessionId && view.agentId === fields.agentId) settle(id, null);
    }
    // Maps keep insertion order, so the first keys are the oldest requests.
    [...requests.keys()].slice(0, Math.max(0, requests.size - maxPending + 1)).forEach((old) => settle(old, null));
    const id = newId();
    const decision = new Promise((resolve) => {
      requests.set(id, { view: { id, ...fields, createdAt: now() }, resolve });
    });
    return { decision, cancel: () => settle(id, null) };
  }

  /** Answer a waiting request from the page. */
  function decide(body) {
    const { id, behavior, reason } = parseDecision(body);
    if (!requests.has(id)) throw new ActionError(404, 'That request was already answered or has gone away');
    settle(id, hookOutput(behavior === 'allow' ? { behavior } : denial(reason)));
    return { behavior };
  }

  /** Drop requests whose session has ended or is no longer waiting on you, or that Claude stopped waiting for. */
  function reconcile({ generatedAt, liveSessions }) {
    for (const [id, { view }] of requests) {
      if (now() - view.createdAt >= MAX_AGE_MS) {
        settle(id, null);
        continue;
      }
      if (generatedAt < view.createdAt + settleGraceMs) continue;
      const session = liveSessions.find((s) => s.sessionId === view.sessionId);
      if (!session?.needsYou) settle(id, null);
    }
  }

  const pending = () => [...requests.values()].map(({ view }) => view);

  return { ask, decide, reconcile, pending };
}
