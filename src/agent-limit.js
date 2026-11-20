import { ActionError } from './errors.js';

/*
 * Settings › Agents › "Most agents running at once": before switchyard starts
 * an agent (New task, Start, a lead and its workers, Review, Resume), it
 * counts the ones running and refuses, saying why, when that's the limit.
 * 0 is no limit.
 */

/**
 * @param {{ maxRunning: () => number, countRunning: () => Promise<number> }} deps `maxRunning()` is read
 *   each time, so a saved change applies to the next start; `countRunning()` counts running agents and
 *   ones on their way.
 */
export function createAgentLimit({ maxRunning, countRunning }) {
  return {
    /** Resolves when another agent may start; a 409 saying how many run when not. */
    async check() {
      const max = maxRunning();
      if (!max) return;
      const running = await countRunning();
      if (running < max) return;
      const are = running === 1 ? '1 agent is' : `${running} agents are`;
      throw new ActionError(409, `${are} running, and Settings › Agents allows ${max} at once; end one to start another`);
    },
  };
}
