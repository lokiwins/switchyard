import { foldsWhenParked, sessionSearchText, type PendingTask } from '../../lib/shared';
import type { AgentsData, EndedSession, LiveSession, Repo, Worktree } from '../../lib/types';

/* What the Agents page lists, and in what order. No React here, so it's tested on its own. */

export type FilterKey = 'all' | 'working' | 'waiting' | 'interrupted' | 'parked' | 'ended';

interface Filter {
  label: string;
  live: ((s: LiveSession) => boolean) | null;
  ended: ((s: EndedSession) => boolean) | null;
}

const isWaiting = (s: LiveSession) => s.status === 'idle' && !s.parked;

/** Each filter picks which live and which ended sessions to show; null shows none of that kind. */
export const FILTERS: Record<FilterKey, Filter> = {
  all: { label: 'All', live: () => true, ended: () => true },
  working: { label: 'Working', live: (s) => s.status === 'busy', ended: null },
  waiting: { label: 'Waiting', live: isWaiting, ended: null },
  interrupted: { label: 'Interrupted', live: null, ended: (s) => s.endState === 'interrupted' },
  parked: { label: 'Parked', live: (s) => Boolean(s.parked), ended: null },
  ended: { label: 'Ended', live: null, ended: () => true },
};

export const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
export const isFilterKey = (value: unknown): value is FilterKey => typeof value === 'string' && value in FILTERS;

// Tasks just started from New task show as working once they start, or as waiting on you while Claude asks to trust the folder.
const PENDING_FILTERS: Partial<Record<FilterKey, (t: PendingTask) => boolean>> = {
  all: () => true,
  working: (t) => t.stage !== 'trust',
  waiting: (t) => t.stage === 'trust',
};

/** Every word of the search appears somewhere in the fields. */
export function matches(fields: (string | null | undefined)[], query: string): boolean {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

/** The repo and worktree a live session runs in, if it's inside one. */
export function locateSession(repos: Repo[], session: LiveSession): { repo: Repo; worktree: Worktree } | null {
  for (const repo of repos) {
    const worktree = repo.worktrees.find((w) => w.agents.live.some((s) => s.pid === session.pid));
    if (worktree) return { repo, worktree };
  }
  return null;
}

export const liveMatches = (data: AgentsData, s: LiveSession, query: string): boolean => {
  const where = locateSession(data.repos, s);
  return matches([...sessionSearchText(s), s.cwd, where?.repo.name, where?.worktree.branch], query);
};

export const endedMatches = (s: EndedSession, query: string): boolean => matches([...sessionSearchText(s), s.cwd, s.repoName, s.branch], query);

export const pendingShown = (tasks: PendingTask[], filter: FilterKey, query: string): PendingTask[] => {
  const shows = PENDING_FILTERS[filter];
  return shows ? tasks.filter(shows).filter((t) => matches([t.prompt, t.repoName, t.branch, t.path], query)) : [];
};

export interface Tile { filter: FilterKey; label: string; value: number; tone?: 'green' | 'amber' }

export function tiles(data: AgentsData): Tile[] {
  const count = (key: FilterKey) => data.liveSessions.filter(FILTERS[key].live ?? (() => false)).length;
  return [
    { filter: 'working', label: 'Working', value: count('working'), tone: 'green' },
    { filter: 'waiting', label: 'Waiting on you', value: count('waiting'), tone: 'amber' },
    { filter: 'interrupted', label: 'Interrupted', value: data.endedSessions.filter((s) => s.endState === 'interrupted').length, tone: 'amber' },
    { filter: 'parked', label: 'Parked', value: count('parked') },
    { filter: 'ended', label: `Ended (${data.endedHistoryDays}d)`, value: data.endedSessions.length },
  ];
}

// Questions waiting on you first, then working, then the rest; newest first within each.
const rank = (s: LiveSession) => (s.needsYou ? 3 : s.status === 'busy' ? 2 : 1);
const byRecent = (a: LiveSession, b: LiveSession) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0);

/**
 * Running sessions: working and waiting first, then parked ones whose tab is
 * still open. Parked ones with no tab to go back to fold away, unless shown.
 */
export function liveGroups(sessions: LiveSession[]): { active: LiveSession[]; parked: LiveSession[] } {
  const working = sessions.filter((s) => !s.parked).sort((a, b) => rank(b) - rank(a) || byRecent(a, b));
  const parkedInTabs = sessions.filter((s) => s.parked && !foldsWhenParked(s)).sort(byRecent);
  return { active: [...working, ...parkedInTabs], parked: sessions.filter(foldsWhenParked).sort(byRecent) };
}

/** A running session, with the sessions working on its task's subtasks (a lead's workers) to show under it. */
export interface LiveEntry { session: LiveSession; workers: LiveSession[] }

const NO_WORKERS: LiveSession[] = [];

/**
 * The running sessions, each lead's workers under it: a session whose task is a subtask goes under the
 * first session on its parent task, when that one is in the list too. A lead and its workers sit where
 * the first of them comes in `sessions`, so in a list sorted by urgency, a worker that needs you brings
 * its lead up with it.
 */
export function nestWorkers(sessions: LiveSession[]): LiveEntry[] {
  const onTask = new Map<string, LiveSession>();
  for (const s of sessions) if (s.hubTask && !onTask.has(s.hubTask.id)) onTask.set(s.hubTask.id, s);
  const leadOf = (s: LiveSession) => {
    const lead = s.hubTask?.parentId ? onTask.get(s.hubTask.parentId) : undefined;
    return lead && lead !== s ? lead : null;
  };
  const workers = new Map<LiveSession, LiveSession[]>();
  for (const s of sessions) {
    const lead = leadOf(s);
    if (lead) workers.set(lead, [...(workers.get(lead) ?? []), s]);
  }
  const placed = new Set<LiveSession>();
  const entries: LiveEntry[] = [];
  for (const s of sessions) {
    const top = leadOf(s) ?? s;
    if (placed.has(top)) continue;
    placed.add(top);
    entries.push({ session: top, workers: workers.get(top) ?? NO_WORKERS });
  }
  return entries;
}

/**
 * The ended workers to list under their lead in Running, by the lead's task id: for each subtask of a listed
 * session's task, its latest ended session, unless the worker is running again. Newest first.
 */
export function endedWorkers(listed: LiveSession[], ended: EndedSession[]): Map<string, EndedSession[]> {
  const listedTasks = new Set(listed.flatMap((s) => (s.hubTask ? [s.hubTask.id] : [])));
  const latest = new Map<string, EndedSession>();
  for (const s of ended) {
    const task = s.hubTask;
    if (!task?.parentId || !listedTasks.has(task.parentId) || listedTasks.has(task.id)) continue;
    const seen = latest.get(task.id);
    if (!seen || s.endedAt > seen.endedAt) latest.set(task.id, s);
  }
  const byLead = new Map<string, EndedSession[]>();
  for (const s of [...latest.values()].sort((a, b) => b.endedAt - a.endedAt)) {
    const lead = s.hubTask!.parentId!;
    byLead.set(lead, [...(byLead.get(lead) ?? []), s]);
  }
  return byLead;
}

export interface RunningShown { sessions: LiveSession[]; active: LiveSession[]; parked: LiveSession[]; parkedShown: boolean; shown: LiveSession[] }

/**
 * The running sessions the Running panel lists for a filter and search: active ones, and parked ones
 * (shown when asked for, with the Parked filter, or when nothing else runs). `shown` is what's on the page.
 */
export function runningShown(data: AgentsData, filter: FilterKey, query: string, showParked: boolean): RunningShown {
  const { live } = FILTERS[filter];
  const sessions = live ? data.liveSessions.filter((s) => live(s) && liveMatches(data, s, query)) : [];
  const { active, parked } = liveGroups(sessions);
  const parkedShown = showParked || filter === 'parked' || active.length === 0;
  return { sessions, active, parked, parkedShown, shown: parkedShown ? sessions : active };
}

const COLLAPSED_LIMIT = 5;

/** Interrupted sessions that need attention always show; with `collapse`, the rest show five at a time unless expanded. */
export function endedShown(sessions: EndedSession[], { expanded, collapse }: { expanded: boolean; collapse: boolean }):
  { shown: EndedSession[]; more: number } {
  const interrupted = sessions.filter((s) => s.needsAttention);
  const others = sessions.filter((s) => !s.needsAttention);
  if (!collapse) return { shown: [...interrupted, ...others], more: 0 };
  const room = Math.max(0, COLLAPSED_LIMIT - interrupted.length);
  return { shown: [...interrupted, ...(expanded ? others : others.slice(0, room))], more: Math.max(0, others.length - room) };
}
