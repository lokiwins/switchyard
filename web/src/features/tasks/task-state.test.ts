import { expect, test } from 'vitest';
import {
  STATE_LABELS, dueOnLabel, groupTasks, linkedWhere, matchesHubTask, startOf, taskState, ticketLabel,
} from './task-state';
import type { TaskIn } from './task-state';
import type { LiveSession } from '../../lib/types';
import type { Work } from './types';

/** Fixture fields, as the server sends them. */
type Fields = Record<string, unknown>;

// Tuesday 10 Nov 2026, mid-morning local time.
const NOW = new Date(2026, 10, 10, 10, 0).getTime();

const task = (overrides: Fields = {}) => ({
  id: 'sy-aaaaaa', title: 'A task', notes: '', dueOn: null, links: [], createdAt: 1, closedAs: null, work: [], ...overrides,
}) as TaskIn;
const work = (overrides: Fields = {}) => ({ repoName: 'shop', path: '/code/shop-x', branch: 'sy-aaaaaa-x', pr: null, live: [], recent: [], checks: [], checkNames: [], ...overrides }) as Work;
const session = (overrides: Fields = {}) => ({ sessionId: 's', status: 'busy', needsYou: false, parked: false, ...overrides }) as LiveSession;

test('a task with no work has not started', () => {
  expect(taskState(task())).toBe('not-started');
});

test('a task whose Claude is busy is working', () => {
  expect(taskState(task({ work: [work({ live: [session()] })] }))).toBe('working');
});

test('a task whose Claude asks something, or waits for your next message, needs you', () => {
  expect(taskState(task({ work: [work({ live: [session({ status: 'idle', needsYou: true })] })] }))).toBe('needs-you');
  expect(taskState(task({ work: [work({ live: [session({ status: 'idle' })] })] }))).toBe('needs-you');
});

test('needing you wins over working, across worktrees', () => {
  const t = task({ work: [work({ live: [session()] }), work({ live: [session({ status: 'idle', needsYou: true })] })] });
  expect(taskState(t)).toBe('needs-you');
});

test('a session idle for over a day (parked) does not need you', () => {
  expect(taskState(task({ work: [work({ live: [session({ status: 'idle', parked: true })] })] }))).toBe('paused');
});

test('an open PR with nothing running is in review; a merged one is done', () => {
  expect(taskState(task({ work: [work({ pr: { number: 4, state: 'OPEN' } })] }))).toBe('in-review');
  expect(taskState(task({ work: [work({ pr: { number: 4, state: 'MERGED' } })] }))).toBe('done');
});

test('a worktree with nothing running and no PR is paused', () => {
  expect(taskState(task({ work: [work()] }))).toBe('paused');
});

test('a lead\'s worker whose session has ended reads Ended, not Paused; while its session is still open it is paused', () => {
  const worker = (overrides: Fields = {}) => task({ parentId: 'sy-lead01', ...overrides });
  expect(taskState(worker({ work: [work()] }))).toBe('ended');
  expect(taskState(worker({ work: [work({ live: [session({ status: 'idle', parked: true })] })] }))).toBe('paused');
  expect(taskState(worker({ work: [work({ pr: { number: 4, state: 'OPEN' } })] }))).toBe('in-review');
  expect(taskState(worker())).toBe('not-started');
  expect(STATE_LABELS.ended).toStrictEqual({ label: 'Ended', tone: '' });
});

test('done or dropped by hand wins over everything', () => {
  expect(taskState(task({ closedAs: 'dropped', work: [work({ live: [session()] })] }))).toBe('dropped');
  expect(taskState(task({ closedAs: 'done' }))).toBe('done');
});

test('dueOnLabel: overdue, today, tomorrow, or the date, by your local day', () => {
  expect(dueOnLabel('2026-11-08', NOW)).toStrictEqual({ text: 'Overdue 2d', tone: 'red' });
  expect(dueOnLabel('2026-11-10', NOW)).toStrictEqual({ text: 'Due today', tone: 'amber' });
  expect(dueOnLabel('2026-11-11', NOW)).toStrictEqual({ text: 'Due tomorrow', tone: 'amber' });
  expect(dueOnLabel('2026-11-20', NOW)).toStrictEqual({ text: 'Due Nov 20', tone: null });
  expect(dueOnLabel(null, NOW)).toBe(null);
});

test('groupTasks: needs you first, then by when it is due, then done; empty groups left out', () => {
  const tasks = [
    task({ id: 'sy-later1', dueOn: '2026-12-01' }),
    task({ id: 'sy-asks01', dueOn: '2026-12-01', work: [work({ live: [session({ status: 'idle', needsYou: true })] })] }),
    task({ id: 'sy-late01', dueOn: '2026-11-09' }),
    task({ id: 'sy-today1', dueOn: '2026-11-10' }),
    task({ id: 'sy-week01', dueOn: '2026-11-16' }),
    task({ id: 'sy-nodue1' }),
    task({ id: 'sy-done01', closedAs: 'done' }),
    task({ id: 'sy-merged', work: [work({ pr: { number: 1, state: 'MERGED' } })] }),
  ];
  const groups = groupTasks(tasks, NOW);
  expect(groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toStrictEqual([
    ['needs-you', ['sy-asks01']],
    ['overdue', ['sy-late01']],
    ['today', ['sy-today1']],
    ['week', ['sy-week01']],
    ['later', ['sy-later1']],
    ['no-date', ['sy-nodue1']],
    ['done', ['sy-done01', 'sy-merged']],
  ]);
  expect(groups.map((g) => g.label)).toStrictEqual(['Needs you', 'Overdue', 'Today', 'This week', 'Later', 'No date', 'Done']);
  expect(groups.find((g) => g.key === 'week')?.tasks[0]?.state, 'each task carries its state').toBe('not-started');
});

test('this week runs to six days ahead; a week away is later', () => {
  const keys = (dueOn: string) => groupTasks([task({ dueOn })], NOW)[0]?.key;
  expect(keys('2026-11-16')).toBe('week');
  expect(keys('2026-11-17')).toBe('later');
});

test('within a group: soonest due first, then work under way before work not started, then newest', () => {
  const tasks = [
    task({ id: 'sy-new001', createdAt: 3 }),
    task({ id: 'sy-old001', createdAt: 1 }),
    task({ id: 'sy-busy01', createdAt: 2, work: [work({ live: [session()] })] }),
    task({ id: 'sy-review', createdAt: 2, work: [work({ pr: { number: 2, state: 'OPEN' } })] }),
  ];
  expect(groupTasks(tasks, NOW)[0]?.tasks.map((t) => t.id)).toStrictEqual(['sy-busy01', 'sy-review', 'sy-new001', 'sy-old001']);
  const later = [task({ id: 'sy-dec020', dueOn: '2026-12-20' }), task({ id: 'sy-dec010', dueOn: '2026-12-10' })];
  expect(groupTasks(later, NOW)[0]?.tasks.map((t) => t.id)).toStrictEqual(['sy-dec010', 'sy-dec020']);
});

test('matchesHubTask: title, id, notes, links and branches, any case', () => {
  const t = task({ title: 'Email receipts', notes: 'After each charge', links: ['https://app.clickup.com/t/86b1abc2d'], work: [work({ branch: 'sy-aaaaaa-receipts' })] });
  for (const query of ['', 'EMAIL', 'sy-aaaaaa', 'each charge', '86b1abc2d', 'receipts']) expect(matchesHubTask(t, query), query).toBe(true);
  expect(matchesHubTask(t, 'invoice')).toBe(false);
});

test('ticketLabel names a link by its tracker, or by its site', () => {
  expect(ticketLabel('https://app.clickup.com/t/86b1abc2d')).toBe('ClickUp 86b1abc2d');
  expect(ticketLabel('https://app.clickup.com/t/9012345/ENG-123')).toBe('ClickUp ENG-123');
  expect(ticketLabel('https://github.com/acme/shop/issues/42')).toBe('GitHub #42');
  expect(ticketLabel('https://acme.atlassian.net/browse/SHOP-17')).toBe('Jira SHOP-17');
  expect(ticketLabel('https://dev.azure.com/acme/shop/_workitems/edit/310')).toBe('ADO 310');
  expect(ticketLabel('https://www.example.com/specs/checkout')).toBe('example.com');
  expect(ticketLabel('not a url')).toBe('link');
});

const start = (path: string, state: string, extra = {}) => ({ path, place: 'switchyard:shop-x', state, trust: null, detail: null, ...extra });

test('a task being started is starting: while New task runs, and until its session shows up', () => {
  expect(taskState(task({ creating: true }))).toBe('starting');
  const started = task({ work: [work({ path: '/code/shop-x' })] });
  expect(taskState(started, [start('/code/shop-x', 'starting')])).toBe('starting');
  expect(taskState(started, [start('/code/elsewhere', 'starting')]), 'another task\'s start is not this one').toBe('paused');
});

test('a task whose Claude asks to trust the folder needs you, and carries the question', () => {
  const trust = { options: [{ label: 'No, exit', selected: true }, { label: 'Yes, I trust this folder', selected: false }] };
  const [group] = groupTasks([task({ work: [work({ path: '/code/shop-x' })] })], NOW, [start('/code/shop-x', 'asking-trust', { trust })]);
  expect(group?.key).toBe('needs-you');
  expect(group?.tasks[0]?.state).toBe('needs-you');
  expect(group?.tasks[0]?.start).toStrictEqual({ path: '/code/shop-x', place: 'switchyard:shop-x', state: 'asking-trust', trust, detail: null });
});

test('a task whose Claude quit before starting is paused, with why', () => {
  const [group] = groupTasks([task({ work: [work({ path: '/code/shop-x' })] })], NOW, [start('/code/shop-x', 'exited', { detail: 'claude: command not found' })]);
  expect(group?.tasks[0]?.state).toBe('paused');
  expect(group?.tasks[0]?.start?.detail).toBe('claude: command not found');
});

test('linkedWhere says where a task made from a session will be linked', () => {
  expect(linkedWhere({ repoName: 'shop', branch: 'fix-login', sessionOnly: false })).toBe('Linked to shop · fix-login');
  expect(linkedWhere({ repoName: 'shop', branch: 'main', sessionOnly: true })).toBe('Linked to this session only, since main is a long-lived branch');
  expect(linkedWhere({ repoName: 'shop', branch: null, sessionOnly: true })).toBe('Linked to this session only');
});

test('a task being closed or deleted shows so at once, before the server answers', () => {
  const base = { id: 'sy-a', title: 'A', notes: '', work: [{ live: [{ status: 'busy' }], pr: { state: 'OPEN' } }] } as TaskIn;
  expect(taskState({ ...base, closing: 'done' })).toBe('closing');
  expect(taskState({ ...base, closing: 'dropped' })).toBe('closing');
  expect(taskState({ ...base, closing: 'delete' })).toBe('deleting');
  // It stays in its group until it's closed, rather than vanishing into Done.
  const [group] = groupTasks([{ ...base, closing: 'done' }], Date.now());
  expect(group?.key).not.toBe('done');
});

test('with several of a task\'s worktrees starting, the one asking to trust its folder is the one shown, then one still starting', () => {
  const t = task({ work: [work({ path: '/code/shop-try1' }), work({ path: '/code/shop-try2' }), work({ path: '/code/shop-try3' })] });
  const start = (path: string, state: string) => ({ path, state, place: `switchyard:${path.split('/').pop()}` });
  expect(startOf(t, [start('/code/shop-try1', 'exited'), start('/code/shop-try2', 'starting'), start('/code/shop-try3', 'asking-trust')])?.path).toBe('/code/shop-try3');
  expect(startOf(t, [start('/code/shop-try1', 'exited'), start('/code/shop-try2', 'starting')])?.path).toBe('/code/shop-try2');
  expect(startOf(t, [start('/elsewhere', 'asking-trust')])).toBe(null);
});

test('subtasks are listed under their parent, each with its own state, not in the groups', () => {
  const parent = task({ id: 'sy-parent', title: 'Ship the cart' });
  const child = task({ id: 'sy-child1', title: 'Fix the totals', parentId: 'sy-parent', work: [work({ path: '/code/shop-c', live: [session({ status: 'busy' })] })] });
  const groups = groupTasks([child, parent], NOW);
  const all = groups.flatMap((g) => g.tasks);
  expect(all.map((t) => t.id)).toStrictEqual(['sy-parent']);
  expect(all[0]?.subtasks?.map((t) => [t.id, t.state])).toStrictEqual([['sy-child1', 'working']]);
});

test('a subtask whose parent isn\'t listed (filtered out, say) is listed on its own', () => {
  const child = task({ id: 'sy-child1', title: 'Fix the totals', parentId: 'sy-parent' });
  expect(groupTasks([child], NOW).flatMap((g) => g.tasks).map((t) => t.id)).toStrictEqual(['sy-child1']);
});

test('a reviewer asking you something makes its task need you; one idle after its verdict doesn\'t', () => {
  const work = (session: Fields) => [{ path: '/code/a', live: [], recent: [], review: { state: 'reviewing', session } }] as unknown as Partial<Work>[];
  expect(taskState({ work: work({ sessionId: 'r', status: 'idle', needsYou: true }) })).toBe('needs-you');
  expect(taskState({ work: work({ sessionId: 'r', status: 'idle', needsYou: false }) })).toBe('paused');
});
