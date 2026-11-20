import { describe, expect, it } from 'vitest';
import type { AgentsData, EndedSession, LiveSession } from '../../lib/types';
import { endedShown, liveGroups, matches, pendingShown, tiles } from './filters';

const live = (id: string, extra: Partial<LiveSession> = {}): LiveSession =>
  ({ sessionId: id, pid: Number(id.replace(/\D/g, '')) || 1, cwd: `/code/${id}`, status: 'idle', statusUpdatedAt: 0, ...extra });
const ended = (id: string, extra: Partial<EndedSession> = {}): EndedSession =>
  ({ sessionId: id, cwd: `/code/${id}`, endedAt: 0, transcript: {}, resumeCommand: '', ...extra });

describe('matches', () => {
  it('needs every word of the search somewhere in the fields, ignoring case', () => {
    expect(matches(['Fix the Login', 'web'], 'login web')).toBe(true);
    expect(matches(['Fix the login', null], 'login api')).toBe(false);
    expect(matches([], '')).toBe(true);
  });
});

describe('liveGroups', () => {
  it('puts sessions asking you something first, then working ones, newest first within each', () => {
    const sessions = [
      live('a1', { status: 'idle', statusUpdatedAt: 5 }),
      live('a2', { status: 'busy', statusUpdatedAt: 1 }),
      live('a3', { status: 'busy', statusUpdatedAt: 9 }),
      live('a4', { needsYou: true, statusUpdatedAt: 0 }),
    ];
    expect(liveGroups(sessions).active.map((s) => s.sessionId)).toEqual(['a4', 'a3', 'a2', 'a1']);
  });

  it('folds parked sessions with no tab to go back to, and keeps ones whose tab is open', () => {
    const inTmux = live('p1', { parked: true, host: { kind: 'tmux', label: 'tmux' } });
    const gone = live('p2', { parked: true, host: null });
    const { active, parked } = liveGroups([inTmux, gone]);
    expect(active.map((s) => s.sessionId)).toEqual(['p1']);
    expect(parked.map((s) => s.sessionId)).toEqual(['p2']);
  });
});

describe('endedShown', () => {
  const sessions = [ended('e1', { needsAttention: true }), ...['e2', 'e3', 'e4', 'e5', 'e6', 'e7'].map((id) => ended(id))];

  it('shows interrupted ones and fills up to five, saying how many more there are', () => {
    const { shown, more } = endedShown(sessions, { expanded: false, collapse: true });
    expect(shown.map((s) => s.sessionId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(more).toBe(2);
  });

  it('shows them all when expanded, or when not collapsing', () => {
    expect(endedShown(sessions, { expanded: true, collapse: true }).shown).toHaveLength(7);
    expect(endedShown(sessions, { expanded: false, collapse: false })).toEqual({ shown: sessions, more: 0 });
  });
});

describe('pendingShown', () => {
  const task = { id: 't1', stage: 'trust' as const, prompt: 'Add receipts', branch: 'add-receipts', createdAt: 0, startedAt: 0 };

  it('shows a task asking to trust its folder under Waiting, not Working', () => {
    expect(pendingShown([task], 'waiting', '')).toHaveLength(1);
    expect(pendingShown([task], 'working', '')).toHaveLength(0);
    expect(pendingShown([task], 'ended', '')).toHaveLength(0);
  });
});

describe('tiles', () => {
  it('counts working, waiting, interrupted, parked and ended', () => {
    const data = {
      liveSessions: [live('a1', { status: 'busy' }), live('a2'), live('a3', { parked: true })],
      endedSessions: [ended('e1', { endState: 'interrupted' }), ended('e2')],
      endedHistoryDays: 7,
    } as AgentsData;
    expect(tiles(data).map((t) => [t.label, t.value])).toEqual([
      ['Working', 1], ['Waiting on you', 1], ['Interrupted', 1], ['Parked', 1], ['Ended (7d)', 2],
    ]);
  });
});
