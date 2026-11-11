/*
 * Making your tasks from tracker tickets: for now, the ClickUp tickets
 * assigned to you, offered in "Add from ClickUp" until a task links them.
 * No DOM here, so it's tested in node.
 */

// A ClickUp task link: app.clickup.com/t/<id>, or /t/<workspace>/<custom id> (see src/task-links.js).
const CLICKUP_TASK = /^\/t\/(?:\d+\/)?([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/;
// What a task's title can hold (see src/task-hub.js).
const MAX_TITLE = 200;
// Characters a title can't have: line breaks, tabs and the like.
const CONTROL = /[\0-\x1f\x7f-\x9f\u2028\u2029]+/g;

/** The ClickUp task id or custom id a link names; null when it isn't a ClickUp task link. */
export function clickupKeyOf(link) {
  try {
    const url = new URL(link);
    return url.hostname === 'app.clickup.com' ? CLICKUP_TASK.exec(url.pathname)?.[1] ?? null : null;
  } catch {
    return null;
  }
}

/** The tickets no task links yet, open or closed, by the ticket's id, custom id or link. */
export function unlinkedTickets(tickets, tasks) {
  const links = tasks.flatMap((task) => task.links ?? []);
  const keys = new Set(links.map(clickupKeyOf).filter(Boolean).map((key) => key.toLowerCase()));
  const urls = new Set(links);
  return tickets.filter((ticket) => !urls.has(ticket.url)
    && ![ticket.id, ticket.customId].some((key) => key && keys.has(key.toLowerCase())));
}

/** A local day as the tasks file keeps it: "2026-11-20". */
function localDay(time) {
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The task a ticket becomes: its name, its link, and the day it's due. */
export function taskFromTicket(ticket) {
  const name = ticket.name.replace(CONTROL, ' ').trim();
  return {
    title: (name || ticket.customId || ticket.id).slice(0, MAX_TITLE),
    notes: '',
    dueOn: ticket.dueAt ? localDay(ticket.dueAt) : null,
    links: [ticket.url ?? `https://app.clickup.com/t/${ticket.id}`],
  };
}

/** Whether a ticket matches the picker's filter: its name, ids, status, or where it lives. */
export function matchesTicket(ticket, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [ticket.name, ticket.id, ticket.customId, ticket.status?.name, ticket.where]
    .some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
}
