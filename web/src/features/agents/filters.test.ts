import { describe, expect, it } from 'vitest';
import type { AgentsData, EndedSession, LiveSession } from '../../lib/types';
import { endedShown, endedWorkers, liveGroups, matches, nestWorkers, pendingShown, runningShown, tiles } from './filters';

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

describe('nestWorkers', () => {
  const lead = (id: string, task: string, extra: Partial<LiveSession> = {}) => live(id, { hubTask: { id: task, title: task }, ...extra });
  const worker = (id: string, task: string, parent: string, extra: Partial<LiveSession> = {}) =>
    live(id, { hubTask: { id: task, title: task, parentId: parent }, ...extra });
  const shape = (entries: ReturnType<typeof nestWorkers>) => entries.map((e) => [e.session.sessionId, e.workers.map((w) => w.sessionId)]);

  it('puts the sessions working on a task\'s subtasks under the session working on the task, in their order', () => {
    const sessions = [lead('l1', 'sy-lead01'), live('x1'), worker('w1', 'sy-work01', 'sy-lead01'), worker('w2', 'sy-work02', 'sy-lead01')];
    expect(shape(nestWorkers(sessions))).toEqual([['l1', ['w1', 'w2']], ['x1', []]]);
  });

  it('places a lead and its workers where the first of them comes, so a worker that needs you brings its lead up', () => {
    const sessions = [worker('w1', 'sy-work01', 'sy-lead01', { needsYou: true }), live('x1'), lead('l1', 'sy-lead01')];
    expect(shape(nestWorkers(sessions))).toEqual([['l1', ['w1']], ['x1', []]]);
  });

  it('leaves a worker on its own when its lead isn\'t in the list (ended, or filtered out)', () => {
    expect(shape(nestWorkers([worker('w1', 'sy-work01', 'sy-gone01'), live('x1')]))).toEqual([['w1', []], ['x1', []]]);
  });

  it('nests under the first session on the task when two run on it', () => {
    const sessions = [lead('l1', 'sy-lead01'), lead('l2', 'sy-lead01'), worker('w1', 'sy-work01', 'sy-lead01')];
    expect(shape(nestWorkers(sessions))).toEqual([['l1', ['w1']], ['l2', []]]);
  });

  it('keeps the same list of workers while nothing about them changes, so a lead\'s row isn\'t drawn again for nothing', () => {
    const sessions = [lead('l1', 'sy-lead01'), live('x1')];
    expect(nestWorkers(sessions)[1]?.workers).toBe(nestWorkers(sessions)[0]?.workers);
  });
});

describe('endedWorkers', () => {
  const lead = live('l1', { hubTask: { id: 'sy-lead01', title: 'Lead' } });
  const done = (id: string, task: string, endedAt: number, parent = 'sy-lead01') =>
    ended(id, { endedAt, hubTask: { id: task, title: task, parentId: parent } });

  it('lists a listed lead\'s ended workers under its task, newest first', () => {
    const byLead = endedWorkers([lead], [done('e1', 'sy-work01', 10), done('e2', 'sy-work02', 30), ended('x1')]);
    expect(byLead.get('sy-lead01')?.map((s) => s.sessionId)).toEqual(['e2', 'e1']);
    expect([...byLead.keys()]).toEqual(['sy-lead01']);
  });

  it('keeps one session per worker (its latest), and none for a worker that is running again', () => {
    const again = live('w3', { hubTask: { id: 'sy-work03', title: 'w3', parentId: 'sy-lead01' } });
    const byLead = endedWorkers([lead, again], [done('e1', 'sy-work01', 10), done('e2', 'sy-work01', 20), done('e3', 'sy-work03', 30)]);
    expect(byLead.get('sy-lead01')?.map((s) => s.sessionId)).toEqual(['e2']);
  });

  it('leaves out workers whose lead isn\'t listed (ended itself, or filtered out)', () => {
    expect(endedWorkers([live('x1')], [done('e1', 'sy-work01', 10)]).size).toBe(0);
    expect(endedWorkers([lead], [done('e1', 'sy-work01', 10, 'sy-other1')]).size).toBe(0);
  });
});

describe('runningShown', () => {
  const data = (liveSessions: LiveSession[]) => ({ liveSessions, repos: [], endedSessions: [] }) as unknown as AgentsData;

  it('shows a folded parked session only once parked ones are asked for, or nothing else runs', () => {
    const sessions = [live('a1', { status: 'busy' }), live('p1', { parked: true, host: null })];
    expect(runningShown(data(sessions), 'all', '', false).shown.map((s) => s.sessionId)).toEqual(['a1']);
    expect(runningShown(data(sessions), 'all', '', true).shown.map((s) => s.sessionId)).toEqual(['a1', 'p1']);
    expect(runningShown(data([sessions[1]!]), 'all', '', false).shown.map((s) => s.sessionId)).toEqual(['p1']);
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
