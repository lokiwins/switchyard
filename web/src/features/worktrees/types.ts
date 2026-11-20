import type { RecentSession } from '../../components/OpenMenu';
import type { Capabilities, HubTaskRef, LiveSession, Nav, Transcript, TrackerTask } from '../../lib/types';

/* What /api/state sends (see src/state.js), as far as the Worktrees page reads it. */

export interface GitStatus {
  ahead: number;
  behind: number;
  changed: number;
  untracked: number;
  conflicted: number;
  upstream?: string | null;
  error?: string;
}

export interface WorktreePr {
  number: number;
  url: string;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED' | string;
  isDraft?: boolean;
  reviewDecision?: string | null;
  mergeStateStatus?: string | null;
  checks?: { state: string; passing: number; failing: number; pending: number; heldCount?: number } | null;
}

export interface LastSession { sessionId: string; resumeCommand: string; updatedAt?: number; transcript?: Transcript & { endState?: string | null } }

export interface WorktreeRow {
  path: string;
  branch?: string | null;
  head?: string | null;
  detached?: boolean;
  isMain?: boolean;
  locked?: boolean;
  prunable?: boolean;
  needsAttention?: boolean;
  canMakeTask?: boolean;
  flags: string[];
  lastActivityAt?: number | null;
  lastCommit?: { subject?: string } | null;
  status?: GitStatus | null;
  pr?: WorktreePr | null;
  task?: TrackerTask | null;
  hubTask?: HubTaskRef | null;
  agents: { live: LiveSession[]; last?: LastSession | null; recent?: RecentSession[] };
}

export interface RepoGroup { name: string; mainPath: string; github?: string | null; worktrees: WorktreeRow[] }

export interface OrphanPr { url: string; number: number; title: string; isDraft?: boolean; updatedAt: string; repository: { nameWithOwner: string } }

export interface StateData {
  generatedAt: number;
  roots: string[];
  repos: RepoGroup[];
  prsWithoutWorktree: OrphanPr[];
  errors: { source: string; message: string }[];
  capabilities: Capabilities;
  nav?: Nav;
}
