import { editorLink, openMenu } from './actions.js';
import { copyButton, h, liveTime, shellQuote, shortPath, timeAgo } from './dom.js';

export const STAGES = {
  'merge-conflict': { label: 'Merge conflict', tone: 'red', group: 'fix' },
  'checks-failing': { label: 'Checks failing', tone: 'red', group: 'fix' },
  'changes-requested': { label: 'Changes requested', tone: 'red', group: 'fix' },
  ready: { label: 'Ready to merge', tone: 'green', group: 'ready' },
  blocked: { label: 'Approved · blocked', tone: 'amber', group: 'ready' },
  'needs-update': { label: 'Behind base', tone: 'amber', group: 'fix' },
  'checks-running': { label: 'Checks running', tone: 'amber', group: 'running' },
  'awaiting-review': { label: 'Awaiting review', tone: '', group: 'review' },
  draft: { label: 'Draft', tone: '', group: 'draft' },
  unknown: { label: 'Unavailable', tone: '', group: 'other' },
};

export const FILTERS = {
  all: { label: 'All', test: () => true },
  fix: { label: 'Needs fixes', test: (pr) => STAGES[pr.stage]?.group === 'fix' },
  ready: { label: 'Ready to merge', test: (pr) => STAGES[pr.stage]?.group === 'ready' },
  running: { label: 'Checks running', test: (pr) => pr.stage === 'checks-running' },
  review: { label: 'Awaiting review', test: (pr) => pr.stage === 'awaiting-review' },
};

const MAX_LISTED_CHECKS = 3;

export function matchesQuery(pr, query) {
  if (!query) return true;
  const haystack = [pr.title, pr.repo, `#${pr.number}`, pr.headRefName, pr.author?.login ?? pr.author]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

/* ---------- tiles ---------- */

export function prTiles(data) {
  const count = (key) => data.authored.filter(FILTERS[key].test).length;
  return [
    { filter: 'ready', label: 'Ready to merge', value: count('ready'), tone: 'green' },
    { filter: 'fix', label: 'Need fixes', value: count('fix'), tone: 'red' },
    { filter: 'running', label: 'Checks running', value: count('running'), tone: 'amber' },
    { filter: 'review', label: 'Awaiting review', value: count('review') },
    { filter: 'all', label: 'Reviews requested of you', value: data.reviewRequested.length, tone: 'purple' },
  ];
}

export function renderPrTiles(tiles, current, onSelect) {
  return tiles.map((tile) => h('button', {
    type: 'button',
    class: ['tile', tile.tone && `tone-${tile.tone}`, tile.value > 0 && 'has-value'].filter(Boolean).join(' '),
    'aria-pressed': String(current === tile.filter && tile.filter !== 'all'),
    onclick: () => onSelect(current === tile.filter ? 'all' : tile.filter),
  }, h('div', { class: 'value' }, tile.value), h('div', { class: 'label' }, tile.label)));
}

/* ---------- PR card pieces ---------- */

function linkList(checks) {
  const shown = checks.slice(0, MAX_LISTED_CHECKS).map((c) => (c.url
    ? h('a', { href: c.url, target: '_blank', rel: 'noopener', title: c.name }, c.label ?? c.name)
    : h('span', { title: c.name }, c.label ?? c.name)));
  const extra = checks.length - shown.length;
  return [shown.flatMap((el, i) => (i ? [', ', el] : [el])), extra > 0 && ` +${extra} more`];
}

function renderChecks(checks) {
  if (!checks || checks.total === 0) return h('span', { class: 'sig muted' }, 'No checks');
  return [
    checks.failing > 0 && h('span', { class: 'sig red' }, `✗ ${checks.failing} failed: `, linkList(checks.failed)),
    checks.pending > 0 && h('span', { class: 'sig amber', title: checks.running.map((c) => c.name).join('\n') }, `● ${checks.pending} running`),
    checks.passing > 0 && h('span', { class: 'sig green', title: `${checks.passing} checks passed` }, `✓ ${checks.passing}`),
    checks.heldCount > 0 && h('span', { class: 'sig muted', title: `Awaiting manual approval:\n${checks.held.map((c) => c.name).join('\n')}` },
      `⏸ ${checks.heldCount} on hold`),
  ];
}

const REVIEW_GLYPHS = {
  APPROVED: ['✓', 'green', 'approved'],
  CHANGES_REQUESTED: ['✗', 'red', 'requested changes'],
  COMMENTED: ['💬', 'muted', 'commented'],
  DISMISSED: ['–', 'muted', 'review dismissed'],
};

const shortLogin = (login) => login.replace(/-pull-request-reviewer$/, '');

function renderReviews(pr) {
  const reviews = pr.reviews ?? [];
  const requested = pr.requested ?? [];
  if (reviews.length === 0 && requested.length === 0) return h('span', { class: 'sig muted' }, 'No reviews');
  return h('span', { class: 'chips' },
    reviews.map((r) => {
      const [glyph, tone, verb] = REVIEW_GLYPHS[r.state] ?? ['·', 'muted', r.state.toLowerCase()];
      return h('span', { class: `chip ${tone}`, title: `${r.login} ${verb} ${timeAgo(Date.parse(r.submittedAt))}` }, `${glyph} ${shortLogin(r.login)}`);
    }),
    requested.map((r) => h('span', { class: 'chip waiting', title: `Review requested from ${r.name}` },
      `⏳ ${r.isTeam ? r.name.split('/').pop() : shortLogin(r.name)}`)));
}

function agentLabel(a) {
  if (a.parked) return 'parked';
  return { busy: 'working', idle: 'waiting' }[a.status] ?? a.status;
}

function renderLocal(pr, caps) {
  const local = pr.local;
  if (!local) {
    return h('span', { class: 'sig muted' }, 'Not checked out',
      copyButton('checkout', `gh pr checkout ${pr.number} --repo ${pr.repo}`));
  }
  return h('span', { class: 'sig' },
    h('span', { class: 'path-inline', title: local.path }, shortPath(local.path)),
    local.dirty && h('span', { class: 'sig amber' }, 'uncommitted'),
    local.agents.map((a) => h('span', { class: 'sig muted', title: a.name },
      h('span', { class: `dot ${a.parked ? 'parked' : a.status}`, 'aria-hidden': 'true' }), agentLabel(a))),
    openMenu(local.path, local.sessions ?? [], caps) ?? copyButton('cd', `cd ${shellQuote(local.path)}`),
    editorLink(local.path, caps));
}

function renderMeta(pr, { showAuthor }) {
  return h('div', { class: 'pr-meta' },
    pr.headRefName && h('span', { class: 'mono' }, pr.headRefName, h('span', { class: 'arrow' }, ' → '), pr.baseRefName),
    showAuthor && pr.author?.login && h('span', { class: 'sep' }, pr.author.login),
    liveTime(Date.parse(pr.updatedAt), 'updated ', { class: 'sep' }),
    pr.fetchedAt && liveTime(pr.fetchedAt, 'checked ', {
      class: `sep${pr.refreshError ? ' stale' : ''}`,
      'aria-label': pr.refreshError ? `Last refresh failed: ${pr.refreshError}` : undefined,
    }),
    Number.isFinite(pr.additions) && h('span', { class: 'sep' },
      h('span', { class: 'num add' }, `+${pr.additions}`), ' ', h('span', { class: 'num del' }, `−${pr.deletions}`),
      h('span', {}, ` · ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'}`)));
}

function renderCopilotButton(pr, onCopilot) {
  if (!pr.copilot || !onCopilot) return null;
  if (pr.copilot.requested) {
    return h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: true }, 'Copilot requested');
  }
  const last = pr.copilot.lastReviewedAt;
  return h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    title: last ? `Ask Copilot to review again (last reviewed ${timeAgo(Date.parse(last))})` : 'Ask Copilot to review this PR',
    onclick: (event) => onCopilot(pr, event.currentTarget),
  }, last ? '↻ Copilot review' : 'Copilot review');
}

export function renderPrCard(pr, { showAuthor = false, onCopilot = null, caps = null } = {}) {
  const stage = STAGES[pr.stage] ?? STAGES.unknown;
  return h('li', {}, h('article', { class: 'pr' },
    h('div', { class: 'pr-line' },
      h('span', { class: `pill ${stage.tone}` }, stage.label),
      h('a', { class: 'pr-title', href: pr.url, target: '_blank', rel: 'noopener', title: pr.title }, pr.title),
      h('span', { class: 'pr-ref' }, `${pr.repo.split('/').pop()}#${pr.number}`)),
    renderMeta(pr, { showAuthor }),
    pr.error
      ? h('div', { class: 'pr-signals' }, h('span', { class: 'sig red' }, `Could not load details: ${pr.error}`))
      : h('div', { class: 'pr-signals' }, renderChecks(pr.checks), renderReviews(pr), renderLocal(pr, caps)),
    h('div', { class: 'pr-side' }, renderCopilotButton(pr, onCopilot))));
}

export function renderPrList(prs, { emptyText, showAuthor, onCopilot, caps }) {
  if (prs.length === 0) return [h('div', { class: 'empty' }, emptyText)];
  return [h('ul', { class: 'list pr-list' }, prs.map((pr) => renderPrCard(pr, { showAuthor, onCopilot, caps })))];
}

export function renderTeamList(prs) {
  if (prs.length === 0) return [h('li', { class: 'muted' }, 'Nothing waiting on your teams.')];
  return prs.map((pr) => h('li', { class: 'team-row' },
    h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'team-title' }, pr.title),
    h('span', { class: 'pr-meta' },
      h('span', { class: 'mono' }, `${pr.repo.split('/').pop()}#${pr.number}`),
      pr.isDraft && h('span', { class: 'sep' }, 'draft'),
      pr.author && h('span', { class: 'sep' }, pr.author),
      pr.commentsCount > 0 && h('span', { class: 'sep' }, `${pr.commentsCount} comment${pr.commentsCount > 1 ? 's' : ''}`),
      h('span', { class: 'sep' }, `updated ${timeAgo(Date.parse(pr.updatedAt))}`))));
}
