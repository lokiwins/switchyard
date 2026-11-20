import type { Capabilities, Nav } from '../../lib/types';
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
