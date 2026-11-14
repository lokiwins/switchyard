import { h, toast } from './dom.js';
import { post } from './actions.js';
import { renderMarkdown } from './markdown.js';
import { STATE_LABELS, ticketLabel, trackerOf } from './task-state.js';

/*
 * A task's details, in a pane over the right of the Tasks page: edit its
 * title, due day, notes and links, and read each linked ticket (ClickUp's from
 * ClickUp, GitHub's through gh), changing a ClickUp ticket's status from here.
 */

const TRACKER_NAMES = { clickup: 'ClickUp', github: 'GitHub', jira: 'Jira', ado: 'Azure DevOps' };

async function fetchTicket(link) {
  const res = await fetch(`/api/hub/ticket?url=${encodeURIComponent(link)}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data;
}

function statusPill(status) {
  const pill = h('span', { class: 'pane-pill ticket-pane-status' }, status.name || 'no status');
  // Set through the style object, which the page's CSP allows, unlike a style attribute.
  if (status.color) pill.style.setProperty('--status', status.color);
  return pill;
}

/** Status ▾: the statuses a ticket can move to (a ClickUp list's, or an issue's open/closed); choosing one changes it there. */
function statusPicker(link, ticket, onChanged) {
  const select = h('select', {
    class: 'pane-select',
    'aria-label': `Status in ${TRACKER_NAMES[ticket.tracker] ?? 'its tracker'}: ${ticket.name ?? ticket.title}`,
    onchange: async () => {
      select.disabled = true;
      try {
        const updated = await post('/api/hub/ticket/status', { url: link, status: select.value });
        toast(`${TRACKER_NAMES[ticket.tracker] ?? 'It'}: ${ticket.name ?? ticket.title} is now ${updated.status.name}`);
        onChanged(updated);
      } catch (error) {
        toast(error.message);
        select.value = ticket.status.name;
      } finally {
        select.disabled = false;
      }
    },
  }, ticket.statuses.map((status) => h('option', { value: status.name, selected: status.name === ticket.status.name }, status.name)));
  return select;
}

/** One linked ticket: what its tracker says about it, or a link to it where switchyard can't read it. */
function ticketCard(link) {
  const tracker = trackerOf(link);
  const card = h('article', { class: `pane-ticket${tracker ? ` is-${tracker}` : ''}` });
  const open = h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'pane-link' }, `Open in ${TRACKER_NAMES[tracker] ?? 'its tracker'} ↗`);
  const head = (...extra) => h('header', { class: 'pane-ticket-head' }, h('span', { class: 'pane-ticket-label' }, ticketLabel(link)), ...extra, open);

  function show(ticket) {
    if (ticket.supported === false) {
      card.replaceChildren(head(), h('p', { class: 'pane-note' }, `switchyard doesn't read ${TRACKER_NAMES[ticket.tracker] ?? 'this site'} yet; open it to see it.`));
      return;
    }
    const title = ticket.name ?? ticket.title;
    card.replaceChildren(
      head(statusPill(ticket.status), ticket.statuses?.length ? statusPicker(link, ticket, show) : null),
      h('h3', { class: 'pane-ticket-title' }, title),
      ticket.description ? renderMarkdown(ticket.description) : h('p', { class: 'pane-note' }, 'No description.'),
    );
  }

  card.replaceChildren(head(), h('p', { class: 'pane-note' }, 'Loading…'));
  fetchTicket(link).then(show, (error) => card.replaceChildren(head(), h('p', { class: 'pane-note' }, error.message)));
  return card;
}

const field = (label, control) => h('label', { class: 'pane-field' }, h('span', {}, label), control);

/**
 * Open the details pane for `task`. `save(fields)` resolves whether it worked;
 * on success the pane closes. A task not made yet (no id) has its own
 * `heading` and `sub` line, and a `submitLabel` for its button.
 */
export function openTaskPane(task, {
  save, heading = task.title, sub = task.id, submitLabel = 'Save',
}) {
  const title = h('input', { name: 'title', type: 'text', class: 'pane-input', required: true, maxlength: '200', value: task.title });
  const dueOn = h('input', { name: 'dueOn', type: 'date', class: 'pane-input', value: task.dueOn ?? '' });
  const notes = h('textarea', { name: 'notes', class: 'pane-input pane-textarea', rows: '6', maxlength: '10000' }, task.notes);
  const links = h('textarea', { name: 'links', class: 'pane-input pane-textarea', rows: '3', spellcheck: 'false' }, task.links.join('\n'));
  const close = () => dialog.close();
  const form = h('form', {
    class: 'pane-form',
    id: `task-form-${task.id ?? 'new'}`,
    onsubmit: async (event) => {
      event.preventDefault();
      const button = dialog.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const saved = await save({
          title: title.value, dueOn: dueOn.value || null, notes: notes.value, links: links.value.split(/\s+/).filter(Boolean),
        });
        if (saved) close();
      } finally {
        button.disabled = false;
      }
    },
  },
  field('Title', title),
  field('Due', dueOn),
  field('Notes (what Claude is told when you start it)', notes),
  field('Ticket links, one per line', links));

  const { label } = STATE_LABELS[task.state] ?? { label: '' };
  const dialog = h('dialog', { class: 'glass-pane task-pane', 'aria-label': task.id ? `Task: ${task.title}` : heading, onclose: () => dialog.remove() },
    h('header', { class: 'pane-header' },
      h('span', { class: 'pane-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'pane-heading' },
        h('strong', {}, heading),
        h('span', { class: 'pane-sub' }, sub)),
      label && h('span', { class: 'pane-pill' }, label),
      h('button', { type: 'button', class: 'pane-btn', title: 'Close without saving', onclick: close }, 'Close')),
    h('div', { class: 'review-body task-pane-body' },
      form,
      task.links.length > 0 && h('section', { class: 'pane-tickets', 'aria-label': 'Linked tickets' },
        h('h2', { class: 'pane-section' }, 'Tickets'),
        task.links.map(ticketCard))),
    h('footer', { class: 'pane-footer' },
      h('span', { class: 'pane-note pane-footer-note' }, 'Esc closes without saving.'),
      h('button', { type: 'submit', form: form.id, class: 'pane-btn is-primary' }, submitLabel)));
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
  return dialog;
}
