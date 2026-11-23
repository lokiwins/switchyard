import { expect, test } from 'vitest';
import {
  clickupKeyOf, matchesTicket, taskFromTicket, unlinkedTickets,
} from './ticket-import';
import { trackerOf } from './task-state';

const ticket = (overrides = {}) => ({
  id: '86b4fx5', customId: null, name: 'Email a receipt after each charge', status: { name: 'to do', color: '#87909e' },
  priority: 'low', dueAt: null, updatedAt: 1, url: 'https://app.clickup.com/t/86b4fx5', where: 'Ideas', ...overrides,
});
const hubTask = (links: string[], overrides = {}) => ({ id: 'sy-aaaaaa', title: 't', links, closedAs: null, ...overrides });

test('clickupKeyOf: the task id or custom id in a ClickUp link, null for anything else', () => {
  expect(clickupKeyOf('https://app.clickup.com/t/86b4fx5')).toBe('86b4fx5');
  expect(clickupKeyOf('https://app.clickup.com/t/9012345/ENG-123')).toBe('ENG-123');
  expect(clickupKeyOf('https://github.com/o/r/issues/1')).toBe(null);
  expect(clickupKeyOf('nope')).toBe(null);
});

test('unlinkedTickets leaves out tickets a task already links, open or closed, by id, custom id or URL', () => {
  const tickets = [
    ticket(),
    ticket({ id: '86b4fx1', url: 'https://app.clickup.com/t/86b4fx1' }),
    ticket({ id: '86b4fx2', customId: 'ENG-7', url: 'https://app.clickup.com/t/86b4fx2' }),
    ticket({ id: '86b4fx3', url: 'https://app.clickup.com/t/86b4fx3' }),
  ];
  const tasks = [
    hubTask(['https://app.clickup.com/t/86b4fx1']),
    hubTask(['https://app.clickup.com/t/9012345/ENG-7'], { closedAs: 'done' }),
    hubTask(['https://github.com/o/r/issues/1']),
  ];
  expect(unlinkedTickets(tickets, tasks).map((t) => t.id)).toStrictEqual(['86b4fx5', '86b4fx3']);
});

test('taskFromTicket: its name, its link and its due day', () => {
  const due = new Date(2026, 10, 20, 17, 0).getTime();
  expect(taskFromTicket(ticket({ dueAt: due }))).toStrictEqual({
    title: 'Email a receipt after each charge', notes: '', dueOn: '2026-11-20', links: ['https://app.clickup.com/t/86b4fx5'],
  });
  expect(taskFromTicket(ticket()).dueOn).toBe(null);
});

test('taskFromTicket makes a link when ClickUp gave none, and keeps a title within what a task takes', () => {
  const made = taskFromTicket(ticket({ url: null, name: `${'x'.repeat(250)}` }));
  expect(made.links).toStrictEqual(['https://app.clickup.com/t/86b4fx5']);
  expect(made.title.length).toBe(200);
  expect(taskFromTicket(ticket({ name: '  ' })).title, 'a ticket with no name is named by its id').toBe('86b4fx5');
});

test('matchesTicket: name, id, custom id, status or where it lives', () => {
  const t = ticket({ customId: 'ENG-7' });
  for (const query of ['', 'receipt', '86B4', 'eng-7', 'to do', 'ideas']) expect(matchesTicket(t, query), query).toBe(true);
  expect(matchesTicket(t, 'invoice')).toBe(false);
});

test('trackerOf names the tracker a link is in, for its badge', () => {
  expect(trackerOf('https://app.clickup.com/t/86b4fx5')).toBe('clickup');
  expect(trackerOf('https://github.com/o/r/issues/1')).toBe('github');
  expect(trackerOf('https://acme.atlassian.net/browse/SHOP-1')).toBe('jira');
  expect(trackerOf('https://dev.azure.com/acme/shop/_workitems/edit/3')).toBe('ado');
  expect(trackerOf('https://example.com/x')).toBe(null);
  expect(trackerOf('nope')).toBe(null);
});
