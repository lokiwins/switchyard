import { h, toast } from './dom.js';
import { announceChange, post } from './actions.js';
import { renderMarkdown } from './markdown.js';
import { sessionTitle } from './session-text.js';

/*
 * "Review": a waiting permission prompt in the glass pane, in full, before you
 * allow it. The diff an Edit or Write would make (with a rendered preview for
 * Markdown), the whole command for Bash, or the tool's input; then Allow, or
 * Deny with an optional reason Claude can act on.
 */

// More lines than this would make the page sluggish; the rest is left to the terminal.
const MAX_DIFF_LINES = 5000;
const SIGNS = { '+': '+', '-': '−', ' ': ' ' };
const KINDS = { '+': 'add', '-': 'del', ' ': 'ctx' };

function renderDiff(diff) {
  if (diff.hunks.length === 0) return h('p', { class: 'pane-note' }, "This doesn't change the file's text.");
  let budget = MAX_DIFF_LINES;
  const hunks = [];
  for (const hunk of diff.hunks) {
    if (budget <= 0) break;
    const lines = hunk.lines.slice(0, budget);
    budget -= lines.length;
    hunks.push(h('div', { class: 'diff-hunk' },
      h('div', { class: 'diff-hunk-head' }, `@@ −${hunk.oldStart ?? 0} +${hunk.newStart ?? 0} @@`),
      lines.map((line) => h('div', { class: `diff-line is-${KINDS[line.type]}` },
        h('span', { class: 'diff-num' }, line.old ?? ''),
        h('span', { class: 'diff-num' }, line.new ?? ''),
        h('span', { class: 'diff-sign' }, SIGNS[line.type]),
        h('span', { class: 'diff-text' }, line.text || ' ')))));
  }
  const total = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return h('div', { class: 'diff' }, hunks,
    total > MAX_DIFF_LINES && h('p', { class: 'pane-note' }, `${total - MAX_DIFF_LINES} more lines aren't shown here; the terminal's prompt has the rest.`));
}

/** Diff, and Rendered for Markdown, as tabs over one body. */
function renderDiffDetail(detail) {
  const views = { diff: () => renderDiff(detail.diff) };
  if (detail.markdown !== null) views.rendered = () => renderMarkdown(detail.markdown);
  const body = h('div', { class: 'review-view' });
  const tabs = Object.keys(views).map((name) => h('button', {
    type: 'button',
    class: 'pane-tab',
    onclick: () => show(name),
  }, name === 'diff' ? 'Diff' : 'Rendered'));
  function show(name) {
    tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.textContent.toLowerCase() === name)));
    body.replaceChildren(views[name]());
  }
  show('diff');
  return [
    detail.note && h('p', { class: 'pane-note' }, detail.note),
    detail.diff.approximate && h('p', { class: 'pane-note' }, 'Too big to compare line by line: the changed part is shown removed and re-added.'),
    tabs.length > 1 && h('div', { class: 'pane-tabs', role: 'group', 'aria-label': 'View' }, tabs),
    body,
  ];
}

function renderDetail(detail) {
  if (detail.kind === 'diff') return renderDiffDetail(detail);
  if (detail.kind === 'command') return h('pre', { class: 'review-code' }, detail.command);
  return h('pre', { class: 'review-code' }, detail.text);
}

function pillText(detail) {
  if (detail.kind !== 'diff') return detail.toolName;
  if (detail.isNewFile) return `new file · +${detail.diff.added}`;
  return `+${detail.diff.added} −${detail.diff.removed}`;
}

async function fetchDetail(id) {
  const res = await fetch(`/api/approvals/detail?id=${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.error ?? `Couldn't load the request (${res.status})`);
  return body.data;
}

/** Open a waiting prompt in the glass pane, to read in full and answer. */
export async function openReview(approval, session) {
  const pill = h('span', { class: 'pane-pill' }, approval.toolName);
  const body = h('div', { class: 'review-body' }, h('p', { class: 'pane-note' }, 'Loading…'));
  const reason = h('input', {
    type: 'text', class: 'pane-input', maxlength: '500', autocomplete: 'off',
    placeholder: 'Reason (optional): tell Claude what to do instead',
  });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const answer = (behavior) => async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const message = behavior === 'deny' ? reason.value.trim() || undefined : undefined;
      await post('/api/approvals/decide', { id: approval.id, behavior, message });
      toast(behavior === 'allow' ? `Allowed ${approval.toolName}` : `Denied ${approval.toolName}`);
      close();
      announceChange();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
  const dialog = h('dialog', { class: 'glass-pane review-pane', 'aria-label': `Review: ${approval.toolName} ${approval.summary}`, onclose: () => dialog.remove() },
    h('header', { class: 'pane-header' },
      h('span', { class: 'pane-dot is-waiting', 'aria-hidden': 'true' }),
      h('div', { class: 'pane-heading' },
        h('strong', {}, `${approval.toolName} · ${sessionTitle(session)}`),
        h('span', { class: 'pane-sub', title: approval.summary }, approval.summary)),
      pill,
      h('button', { type: 'button', class: 'pane-btn', title: 'Close (the prompt keeps waiting)', onclick: close }, 'Close')),
    body,
    h('footer', { class: 'pane-footer' },
      reason,
      h('button', { type: 'button', class: 'pane-btn', title: 'Deny; with a reason, Claude adjusts instead of stopping', onclick: answer('deny') }, 'Deny'),
      h('button', { type: 'button', class: 'pane-btn is-primary', title: 'Allow once', onclick: answer('allow') }, 'Allow')));
  document.body.append(dialog);
  dialog.showModal();
  try {
    const detail = await fetchDetail(approval.id);
    pill.textContent = pillText(detail);
    body.replaceChildren(...[renderDetail(detail)].flat().filter(Boolean));
  } catch (error) {
    body.replaceChildren(h('p', { class: 'pane-note' }, error.message));
  }
}
