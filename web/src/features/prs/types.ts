import type { Capabilities, LiveSession, Nav } from '../../lib/types';
import type { RecentSession } from '../../components/OpenMenu';

/* What /api/prs and its stream send (see src/prs.js), as far as the page reads it. */

export interface CheckRef { name: string; label?: string; url?: string | null }
export interface Checks {
  total: number;
  failing: number;
  pending: number;
  passing: number;
  heldCount: number;
  failed: CheckRef[];
  running: CheckRef[];
  held: CheckRef[];
}
export interface Review { login: string; state: string; submittedAt: string }
export interface Requested { name: string; isTeam?: boolean }
export interface LocalAgent { name?: string; status: string; parked?: boolean }
export interface LocalCheckout { path: string; dirty?: boolean; agents: LocalAgent[]; sessions?: RecentSession[] }

/** A PR review agent's review (see src/pr-review.js): how it's going or went, and where. */
export interface AgentReview {
  state: 'reviewing' | 'needs you' | 'approve' | 'changes' | 'clarify' | 'no verdict';
  /** The verdict its report ends on, if any; kept while it asks you something after it. */
  verdict?: 'approve' | 'changes' | 'clarify' | null;
  /** The reviewer's last reply: its report, once it's done. */
  summary: string | null;
  startedAt: number;
  /** Its own checkout of the PR. */
  path: string;
  /** The reviewer's session while it runs. */
  session: LiveSession | null;
  /** The PR has commits the review didn't see. */
  outdated: boolean;
}

export interface Pr {
  repo: string;
  number: number;
  title: string;
  url: string;
  stage: string;
  headRefName?: string;
  baseRefName?: string;
  author?: { login?: string } | null;
  updatedAt: string;
  fetchedAt?: number | null;
  refreshError?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  error?: string | null;
  checks?: Checks | null;
  reviews?: Review[];
  requested?: Requested[];
  local?: LocalCheckout | null;
  copilot?: { requested?: boolean; lastReviewedAt?: string | null } | null;
  /** On a PR awaiting your review: whether its repo is cloned here, so a review agent can check it out. */
  canAgentReview?: boolean;
  /** On a PR awaiting your review: its review agent's review, if one was started. */
  agentReview?: AgentReview | null;
}

export interface TeamPr {
  url: string;
  title: string;
  repo: string;
  number: number;
  isDraft?: boolean;
  author?: string | null;
  commentsCount?: number;
  updatedAt: string;
}

export interface PrsData {
  authored: Pr[];
  reviewRequested: Pr[];
  teamReviewRequested: TeamPr[];
  errors: { source: string; message: string }[];
  syncedAt?: number | null;
  capabilities: Capabilities;
  nav?: Nav;
}
