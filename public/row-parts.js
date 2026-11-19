import { answerElsewhere, sessionDetail, sessionDot, sessionLabel, sessionTitle } from './session-text.js';

/*
 * Rows on the Agents and PRs pages are drawn in parts. Each part's sig is
 * everything that part is drawn from, so a redraw rebuilds only the parts
 * whose sig changed (see keyed.js) and keeps the rest exactly as they are:
 * an open menu, a reply being typed, keyboard focus. Kept apart from the DOM
 * so it can be tested. (The Tasks page's rows are in task-row-parts.js.)
 */

const sig = (value) => JSON.stringify(value);

/**
 * A live session's row: `where` is its repo and worktree (null outside one),
 * `approvals` the questions waiting from this session.
 */
export function liveRowParts(session, { where, approvals, detailOpen }) {
  const pr = where?.worktree.pr;
  return [
    { key: 'badge', sig: sig([session.status, session.parked, sessionDot(session), sessionLabel(session)]) },
    {
      key: 'who',
      sig: sig([sessionTitle(session), session.cwd, session.host?.kind, session.host?.label, session.host?.window,
        where?.repo.name ?? null, where?.worktree.branch ?? session.transcript?.gitBranch ?? null]),
    },
    {
      key: 'detail',
      sig: sig([approvals.length > 0 ? approvals.map((a) => [a.id, a.toolName, a.summary]) : sessionDetail(session),
        answerElsewhere(session, approvals), detailOpen]),
    },
    { key: 'time', sig: sig([session.statusUpdatedAt, sessionLabel(session)]) },
    {
      // What the buttons act on and offer; a kept button reads nothing else.
      key: 'actions',
      sig: sig([session.sessionId, session.pid, session.cwd, session.host ?? null, session.status, session.needsYou ?? false,
        session.screenPrompt ?? null, session.hubTask ?? null, approvals.map((a) => a.id),
        where?.worktree.task ?? null, pr ? [pr.url, pr.number] : null]),
    },
  ];
}

/** A PR card's parts; `canAskCopilot` says whether the page offers Copilot reviews here. */
export function prCardParts(pr, { showAuthor, canAskCopilot, caps }) {
  return [
    { key: 'line', sig: sig([pr.stage, pr.title, pr.url, pr.repo, pr.number]) },
    {
      key: 'meta',
      sig: sig([pr.headRefName, pr.baseRefName, showAuthor && pr.author?.login, pr.updatedAt, pr.fetchedAt, pr.refreshError ?? null,
        pr.additions, pr.deletions, pr.changedFiles]),
    },
    ...(pr.error
      ? [{ key: 'error', sig: sig(pr.error) }]
      : [
        { key: 'checks', sig: sig(pr.checks ?? null) },
        { key: 'reviews', sig: sig([pr.reviews ?? [], pr.requested ?? []]) },
        { key: 'local', sig: sig([pr.local ?? null, pr.repo, pr.number, caps]) },
      ]),
    { key: 'side', sig: sig([canAskCopilot && pr.copilot, pr.repo, pr.number]) },
  ];
}
