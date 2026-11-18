import { createClaudeProvider } from '../../src/agents/claude.js';
import { createAgentProviders } from '../../src/agents/providers.js';

/*
 * The agent providers tests run with: the real Claude provider (its sessions
 * folder doesn't exist, so it lists none) and a second, made-up agent CLI,
 * so tests can check that commands come from the provider asked for.
 */

/** A made-up agent CLI called `other-agent`, with its own launch and resume commands. */
export const otherAgent = {
  id: 'other',
  label: 'Other agent',
  command: 'other-agent',
  launchCommand: (prompt) => (prompt ? `other-agent --task '${prompt}'` : 'other-agent'),
  resumeCommand: (sessionId) => `other-agent --continue ${sessionId}`,
  liveSessions: async () => [],
  latestSession: async () => null,
  recentSessions: async () => [],
  endedSessions: async () => [],
};

export const testAgents = () => createAgentProviders([createClaudeProvider({ claudeDir: '/nonexistent-claude-dir' }), otherAgent]);
