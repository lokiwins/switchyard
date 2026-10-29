import { copyButton, h, shellQuote, shortPath, timeAgo } from './dom.js';
import { sessionDetail, sessionSearchText, sessionTitle } from './session-text.js';
import { editorLink, openMenu, resumeButton } from './actions.js';
import { sessionDot, sessionLabel } from './agent-views.js';
import { endStateOf } from './ended-views.js';

const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

export const VIEWS = {
  active: { label: 'Active', test: (w) => isActive(w) },
  attention: { label: 'Needs attention', test: (w) => w.needsAttention },
  agents: { label: 'Agents', test: (w) => w.agents.live.length > 0 || w.flags.includes('agent-interrupted') },
  prs: { label: 'Open PRs', test: (w) => w.pr?.state === 'OPEN' },
  dirty: { label: 'Uncommitted', test: (w) => w.flags.includes('dirty') },
  cleanup: { label: 'Clean up', test: (w) => w.flags.includes('cleanup') },
  all: { label: 'All', test: () => true },
};
export const SEGMENTED_VIEWS = ['active', 'attention', 'agents', 'cleanup', 'all'];

function isActive(w) {
  return w.agents.live.length > 0
    || w.flags.includes('dirty')
    || w.flags.includes('cleanup')
    || w.pr?.state === 'OPEN'
    || (w.lastActivityAt && Date.now() - w.lastActivityAt < RECENT_MS);
}

export function matchesSearch(w, query) {
  if (!query) return true;
  const haystack = [w.branch, w.path, w.pr?.title, w.pr && `#${w.pr.number}`, ...w.agents.live.flatMap(sessionSearchText)]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

/* ---------- summary tiles ---------- */

export function summarize(state) {
  const worktrees = state.repos.flatMap((r) => r.worktrees);
  const count = (view) => worktrees.filter(VIEWS[view].test).length;
  return [
    { view: 'attention', label: 'Need attention', value: count('attention'), tone: 'red' },
    { view: 'prs', label: 'Worktrees with open PRs', value: count('prs'), tone: 'purple' },
    { view: 'dirty', label: 'Uncommitted changes', value: count('dirty') },
    { view: 'cleanup', label: 'Ready to clean up', value: count('cleanup') },
  ];
}

/** Clicking a tile filters to it; clicking it again goes back to the full view. */
export function renderTiles(tiles, currentView, onSelect) {
  return tiles.map((tile) => h('button', {
    type: 'button',
    class: ['tile', tile.tone && `tone-${tile.tone}`, tile.value > 0 && 'has-value'].filter(Boolean).join(' '),
    'aria-pressed': String(currentView === tile.view),
    title: currentView === tile.view ? 'Click again to show all worktrees' : undefined,
    onclick: () => onSelect(currentView === tile.view ? 'all' : tile.view),
  }, h('div', { class: 'value' }, tile.value), h('div', { class: 'label' }, tile.label)));
}

const MAX_INLINE_SESSIONS = 2;

/* ---------- worktree table ---------- */

function renderBranchCell(w) {
  const secondary = [shortPath(w.path), w.lastCommit?.subject].filter(Boolean).join('  ·  ');
  return h('td', {}, h('div', { class: 'cell-lines' },
    h('div', { class: 'line' },
      h('span', { class: 'branch-name', title: w.branch ?? undefined },
        w.branch ?? (w.detached ? `detached @ ${w.head?.slice(0, 7)}` : '—')),
      w.isMain && h('span', { class: 'tag' }, 'main'),
      w.locked && h('span', { class: 'pill amber' }, 'locked')),
    h('span', { class: 'secondary', title: `${w.path}${w.lastCommit?.subject ? `\n${w.lastCommit.subject}` : ''}` }, secondary)));
}

function renderLocalCell(w) {
  if (w.prunable) return h('td', {}, h('span', { class: 'pill red' }, 'missing on disk'));
  const s = w.status;
  if (!s) return h('td', {}, '—');
  if (s.error) return h('td', {}, h('span', { class: 'pill red', title: s.error }, 'git error'));
  const dirty = s.changed || s.untracked || s.conflicted;
  const sync = [
    s.ahead > 0 && h('span', { class: 'num add', title: 'Commits ahead of upstream' }, `↑${s.ahead}`),
    s.behind > 0 && h('span', { class: 'num del', title: 'Commits behind upstream' }, `↓${s.behind}`),
    w.branch && !s.upstream && h('span', {}, 'not pushed'),
  ].filter(Boolean);
  return h('td', {}, h('div', { class: 'cell-lines' },
    h('div', { class: 'line' },
      s.conflicted > 0 && h('span', { class: 'pill red' }, `${s.conflicted} conflicted`),
      s.changed > 0 && h('span', { class: 'pill amber' }, `${s.changed} changed`),
      s.untracked > 0 && h('span', { class: 'tag' }, `${s.untracked} untracked`),
      !dirty && h('span', { class: 'small muted' }, 'clean')),
    sync.length > 0 && h('div', { class: 'line secondary' }, sync)));
}

const PR_STATE_PILLS = {
  MERGED: ['Merged', 'purple'],
  CLOSED: ['Closed', 'red'],
};
const CHECK_PILLS = {
  passing: ['✓', 'green', 'Checks passing'],
  failing: ['✗ checks', 'red', 'Checks failing'],
  pending: ['● running', 'amber', 'Checks running'],
};
const REVIEW_PILLS = {
  APPROVED: ['Approved', 'green'],
  CHANGES_REQUESTED: ['Changes requested', 'red'],
  REVIEW_REQUIRED: ['Needs review', ''],
};

function pill([text, tone, hint], title) {
  return h('span', { class: `pill ${tone}`, title: title ?? hint }, text);
}

function renderPrCell(w) {
  const pr = w.pr;
  if (!pr) return h('td', {}, h('span', { class: 'small muted' }, '—'));
  const checks = pr.checks;
  const isOpen = pr.state === 'OPEN';
  const checksTitle = checks
    ? `${checks.passing} passing · ${checks.failing} failing · ${checks.pending} running${checks.heldCount ? ` · ${checks.heldCount} awaiting approval` : ''}`
    : undefined;
  return h('td', {}, h('div', { class: 'cell-lines' },
    h('div', { class: 'line' },
      h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'mono' }, `#${pr.number}`),
      !isOpen && pill(PR_STATE_PILLS[pr.state] ?? [pr.state, '']),
      isOpen && pr.isDraft && pill(['Draft', '']),
      isOpen && checks && CHECK_PILLS[checks.state] && pill(CHECK_PILLS[checks.state], checksTitle),
      isOpen && REVIEW_PILLS[pr.reviewDecision] && pill(REVIEW_PILLS[pr.reviewDecision]),
      isOpen && pr.mergeStateStatus === 'DIRTY' && pill(['Conflict', 'red', 'Merge conflict with the base branch'])),
    h('span', { class: 'secondary', title: pr.title }, pr.title)));
}

function detailLine(session) {
  const detail = sessionDetail(session);
  if (!detail) return null;
  const text = detail.label ? `${detail.label}: ${detail.text}` : detail.text;
  return h('span', { class: 'secondary', title: text }, text);
}

function renderInlineSession(s) {
  return h('div', { class: 'cell-lines' },
    h('div', { class: 'line' },
      h('span', { class: `dot ${sessionDot(s)}`, 'aria-hidden': 'true' }),
      h('span', { class: 'small no-shrink' }, sessionLabel(s)),
      h('span', { class: 'small strong', title: s.cwd }, sessionTitle(s))),
    detailLine(s));
}

function renderAgentCell(w, caps) {
  const live = [...w.agents.live].sort((a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0));
  if (live.length > 0) {
    const hidden = live.length - MAX_INLINE_SESSIONS;
    return h('td', {}, h('div', { class: 'cell-lines' },
      live.slice(0, MAX_INLINE_SESSIONS).map(renderInlineSession),
      hidden > 0 && h('a', { class: 'secondary', href: '/' }, `+${hidden} more on the Agents page`)));
  }
  const last = w.agents.last;
  if (!last) return h('td', {}, h('span', { class: 'small muted' }, '—'));
  const interrupted = w.flags.includes('agent-interrupted');
  const ending = last.transcript && endStateOf({ endState: last.transcript.endState });
  return h('td', {}, h('div', { class: 'cell-lines' },
    h('div', { class: 'line' },
      interrupted
        ? h('span', { class: 'pill amber', title: ending.hint }, `Interrupted ${timeAgo(last.updatedAt)}`)
        : h('span', { class: 'small muted', title: ending?.hint }, `Last session ${timeAgo(last.updatedAt)}`),
      resumeButton(last, caps) ?? copyButton('resume', last.resumeCommand)),
    h('span', { class: 'small strong' }, sessionTitle({ ...last, cwd: w.path })),
    detailLine(last)));
}

export function cleanupCommand(repo, w) {
  const steps = [`git -C ${shellQuote(repo.mainPath)} worktree remove ${shellQuote(w.path)}`];
  // Squash merges leave the branch "unmerged" to git, so -D is needed; a
  // closed-but-unmerged PR keeps its branch in case the work is wanted later.
  if (w.branch && w.pr?.state === 'MERGED') steps.push(`git -C ${shellQuote(repo.mainPath)} branch -D ${shellQuote(w.branch)}`);
  return steps.join(' && ');
}

function renderActionsCell(repo, w, caps) {
  return h('td', {}, h('div', { class: 'actions' },
    w.prunable ? null : openMenu(w.path, w.agents.recent ?? [], caps) ?? copyButton('cd', `cd ${shellQuote(w.path)}`),
    !w.prunable && editorLink(w.path, caps),
    w.flags.includes('cleanup') && copyButton('clean up', cleanupCommand(repo, w),
      `PR ${w.pr.state.toLowerCase()} — copy: ${cleanupCommand(repo, w)}`)));
}

function renderRow(repo, w, caps) {
  return h('tr', { class: w.needsAttention ? 'attention' : undefined },
    renderBranchCell(w),
    renderLocalCell(w),
    renderPrCell(w),
    renderAgentCell(w, caps),
    h('td', { class: 'cell-activity', title: w.lastActivityAt ? new Date(w.lastActivityAt).toLocaleString() : undefined }, timeAgo(w.lastActivityAt)),
    renderActionsCell(repo, w, caps));
}

function repoBadges(repo, rows) {
  const live = rows.reduce((n, w) => n + w.agents.live.length, 0);
  const attention = rows.filter((w) => w.needsAttention).length;
  const cleanup = rows.filter((w) => w.flags.includes('cleanup')).length;
  return h('span', { class: 'repo-meta' },
    h('span', { class: 'muted' }, `${rows.length} of ${repo.worktrees.length} worktrees`),
    live > 0 && h('span', { class: 'muted sep' }, `${live} agent${live > 1 ? 's' : ''}`),
    cleanup > 0 && h('span', { class: 'muted sep' }, `${cleanup} to clean up`),
    attention > 0 && h('span', { class: 'pill red' }, `${attention} need${attention > 1 ? '' : 's'} attention`));
}

const COLUMNS = [
  ['Worktree', 'col-branch'], ['Local', 'col-local'], ['Pull request', 'col-pr'],
  ['Agent', 'col-agent'], ['Activity', 'col-activity'], ['', 'col-actions'],
];

function renderRepo(repo, rows, { isCollapsed, onToggle, caps }) {
  const details = h('details', { class: 'repo', open: !isCollapsed },
    h('summary', {},
      h('span', { class: 'repo-name' }, repo.name),
      repo.github && h('a', { href: `https://github.com/${repo.github}`, target: '_blank', rel: 'noopener', class: 'repo-link' }, repo.github),
      repoBadges(repo, rows)),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('colgroup', {}, COLUMNS.map(([, col]) => h('col', { class: col }))),
      h('thead', {}, h('tr', {}, COLUMNS.map(([label]) => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, rows.map((w) => renderRow(repo, w, caps))))));
  details.addEventListener('toggle', () => onToggle(repo.mainPath, !details.open));
  return details;
}

const byActivity = (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);

export function renderRepos(state, { view, query, collapsed, onToggle, onShowAll }) {
  const test = VIEWS[view]?.test ?? VIEWS.active.test;
  const groups = state.repos
    .map((repo) => ({ repo, rows: repo.worktrees.filter((w) => test(w) && matchesSearch(w, query)).sort(byActivity) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => byActivity(a.rows[0], b.rows[0]));
  if (groups.length === 0) {
    const narrowed = view !== 'all' || query;
    return [h('div', { class: 'empty' },
      h('p', {}, 'No worktrees match this view.'),
      narrowed && h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: onShowAll }, 'Show all worktrees'))];
  }
  return groups.map(({ repo, rows }) => renderRepo(repo, rows, {
    isCollapsed: collapsed.has(repo.mainPath), onToggle, caps: state.capabilities,
  }));
}

export function renderOrphanPrs(prs) {
  return prs.map((pr) => h('li', { class: 'row' },
    h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'mono' }, `${pr.repository.nameWithOwner}#${pr.number}`),
    pr.isDraft && pill(['Draft', '']),
    h('span', {}, pr.title),
    h('span', { class: 'small muted' }, `updated ${timeAgo(Date.parse(pr.updatedAt))}`)));
}
