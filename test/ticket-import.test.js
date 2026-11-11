import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clickupKeyOf, matchesTicket, taskFromTicket, unlinkedTickets,
} from '../public/ticket-import.js';
import { trackerOf } from '../public/task-state.js';

const ticket = (overrides = {}) => ({
  id: '86b4fx5', customId: null, name: 'Email a receipt after each charge', status: { name: 'to do', color: '#87909e' },
  priority: 'low', dueAt: null, updatedAt: 1, url: 'https://app.clickup.com/t/86b4fx5', where: 'Ideas', ...overrides,
});
const hubTask = (links, overrides = {}) => ({ id: 'sy-aaaaaa', title: 't', links, closedAs: null, ...overrides });

test('clickupKeyOf: the task id or custom id in a ClickUp link, null for anything else', () => {
  assert.equal(clickupKeyOf('https://app.clickup.com/t/86b4fx5'), '86b4fx5');
  assert.equal(clickupKeyOf('https://app.clickup.com/t/9012345/ENG-123'), 'ENG-123');
  assert.equal(clickupKeyOf('https://github.com/o/r/issues/1'), null);
  assert.equal(clickupKeyOf('nope'), null);
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
  assert.deepEqual(unlinkedTickets(tickets, tasks).map((t) => t.id), ['86b4fx5', '86b4fx3']);
});

test('taskFromTicket: its name, its link and its due day', () => {
  const due = new Date(2026, 10, 20, 17, 0).getTime();
  assert.deepEqual(taskFromTicket(ticket({ dueAt: due })), {
    title: 'Email a receipt after each charge', notes: '', dueOn: '2026-11-20', links: ['https://app.clickup.com/t/86b4fx5'],
  });
  assert.equal(taskFromTicket(ticket()).dueOn, null);
});

test('taskFromTicket makes a link when ClickUp gave none, and keeps a title within what a task takes', () => {
  const made = taskFromTicket(ticket({ url: null, name: `${'x'.repeat(250)}` }));
  assert.deepEqual(made.links, ['https://app.clickup.com/t/86b4fx5']);
  assert.equal(made.title.length, 200);
  assert.equal(taskFromTicket(ticket({ name: '  ' })).title, '86b4fx5', 'a ticket with no name is named by its id');
});

test('matchesTicket: name, id, custom id, status or where it lives', () => {
  const t = ticket({ customId: 'ENG-7' });
  for (const query of ['', 'receipt', '86B4', 'eng-7', 'to do', 'ideas']) assert.equal(matchesTicket(t, query), true, query);
  assert.equal(matchesTicket(t, 'invoice'), false);
});

test('trackerOf names the tracker a link is in, for its badge', () => {
  assert.equal(trackerOf('https://app.clickup.com/t/86b4fx5'), 'clickup');
  assert.equal(trackerOf('https://github.com/o/r/issues/1'), 'github');
  assert.equal(trackerOf('https://acme.atlassian.net/browse/SHOP-1'), 'jira');
  assert.equal(trackerOf('https://dev.azure.com/acme/shop/_workitems/edit/3'), 'ado');
  assert.equal(trackerOf('https://example.com/x'), null);
  assert.equal(trackerOf('nope'), null);
});
