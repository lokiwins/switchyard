/*
 * The made-up world the screenshots show: two repos, their worktrees, Claude
 * sessions in them and their pull requests. Everything is neutral example
 * data (acme/…, dev) because the images are published.
 *
 * Times are minutes before the fixture's "now", so the page reads the same
 * however long ago the run started.
 */

export const VIEWER = 'dev';

/** Repos under ~/code, each with worktrees beside it as <repo>-<suffix>. */
export const REPOS = [
  {
    name: 'storefront',
    github: 'acme/storefront',
    files: { 'README.md': '# storefront\n', 'src/auth/redirect.js': 'export const AFTER_LOGIN = "/";\n' },
    worktrees: [
      { suffix: 'login-redirect', branch: 'fix-login-redirect', commitMinutesAgo: 40, dirty: true },
      { suffix: 'dark-mode', branch: 'feat/dark-mode', commitMinutesAgo: 90 },
      { suffix: 'remove-banner', branch: 'chore/remove-banner', commitMinutesAgo: 60 * 30 },
    ],
  },
  {
    name: 'billing-api',
    github: 'acme/billing-api',
    files: { 'README.md': '# billing-api\n', 'src/retry.js': 'export const MAX_RETRIES = 3;\n' },
    worktrees: [
      { suffix: 'retry-backoff', branch: 'feat/retry-backoff', commitMinutesAgo: 25 },
    ],
  },
];

const THEME_FILE = 'src/theme.css';

/**
 * Claude Code sessions. `status` makes one running (a live process is started
 * for it); without it the session has ended. `worktree` is "<repo>" or
 * "<repo>-<suffix>".
 */
export const SESSIONS = [
  {
    worktree: 'storefront-login-redirect',
    status: 'busy',
    title: 'Fix the login redirect on the settings page',
    minutesAgo: 1,
    turns: [
      { prompt: 'After logging in from the settings page we land on the home page. Send people back where they were.' },
      { reply: 'The redirect target is hard-coded. I\'ll read it from the `next` query parameter and validate it.', tool: { name: 'Edit', input: { file_path: 'src/auth/redirect.js', old_string: '"/"', new_string: 'next' } } },
    ],
  },
  {
    worktree: 'storefront-dark-mode',
    status: 'waiting',
    title: 'Add a dark mode toggle',
    minutesAgo: 3,
    approval: {
      tool_name: 'Edit',
      file: THEME_FILE,
      old_string: '  --bg: #ffffff;\n  --fg: #1f2328;\n',
      new_string: '  --bg: #ffffff;\n  --fg: #1f2328;\n}\n\n[data-theme="dark"] {\n  --bg: #0d1117;\n  --fg: #e6edf3;\n',
    },
    files: { [THEME_FILE]: ':root {\n  --bg: #ffffff;\n  --fg: #1f2328;\n}\n' },
    turns: [
      { prompt: 'Add a dark mode toggle to the header that remembers the choice.' },
      { reply: 'I\'ll add dark theme variables to theme.css, then the toggle.', tool: { name: 'Edit', input: { file_path: THEME_FILE } } },
    ],
  },
  {
    worktree: 'billing-api-retry-backoff',
    status: 'idle',
    title: 'Retry failed charges with backoff',
    minutesAgo: 12,
    turns: [
      { prompt: 'Retry failed charges with exponential backoff, at most 3 times.' },
      { reply: 'Done. Failed charges now retry after 1s, 2s and 4s, and the tests cover each step. Want me to open a PR?' },
    ],
  },
  {
    worktree: 'storefront',
    status: 'idle',
    title: 'Upgrade the test runner',
    minutesAgo: 60 * 30,
    turns: [
      { prompt: 'Upgrade the test runner to the latest version.' },
      { reply: 'Upgraded. Two snapshot tests needed new snapshots; everything passes.' },
    ],
  },
  {
    worktree: 'storefront-remove-banner',
    title: 'Remove the holiday banner',
    minutesAgo: 60 * 26,
    turns: [
      { prompt: 'Remove the holiday banner from every page.' },
      { reply: 'Removed the banner component and its styles. PR #41 is up.' },
    ],
  },
  {
    worktree: 'billing-api',
    title: 'Investigate the flaky invoice test',
    minutesAgo: 60 * 5,
    turns: [
      { prompt: 'The invoice total test fails about one run in ten. Find out why.' },
    ],
  },
];

const check = (name, conclusion, minutesAgo, now) => ({
  __typename: 'CheckRun',
  name,
  workflowName: 'CI',
  status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
  conclusion: conclusion ?? '',
  startedAt: new Date(now - minutesAgo * 60_000).toISOString(),
  detailsUrl: 'https://github.com/acme/storefront/actions',
});

const iso = (now, minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

/** Pull requests as gh returns them; `headRefOid` is filled in from the fixture repos. */
export function pullRequests(now) {
  const base = (repo, number, fields) => ({
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    repository: { nameWithOwner: repo, name: repo.split('/')[1] },
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    author: { login: VIEWER },
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'REVIEW_REQUIRED',
    latestReviews: [],
    reviewRequests: [],
    commentsCount: 0,
    additions: 40,
    deletions: 6,
    changedFiles: 3,
    ...fields,
  });
  return [
    base('acme/storefront', 42, {
      title: 'Add a dark mode toggle',
      headRefName: 'feat/dark-mode',
      createdAt: iso(now, 120),
      updatedAt: iso(now, 20),
      mergeStateStatus: 'UNSTABLE',
      statusCheckRollup: [check('test', 'FAILURE', 30, now), check('lint', 'SUCCESS', 30, now)],
      commentsCount: 2,
    }),
    base('acme/storefront', 41, {
      title: 'Remove the holiday banner',
      headRefName: 'chore/remove-banner',
      state: 'MERGED',
      createdAt: iso(now, 60 * 30),
      updatedAt: iso(now, 60 * 20),
      reviewDecision: 'APPROVED',
      statusCheckRollup: [check('test', 'SUCCESS', 60 * 25, now)],
    }),
    base('acme/billing-api', 17, {
      title: 'Retry failed charges with backoff',
      headRefName: 'feat/retry-backoff',
      createdAt: iso(now, 50),
      updatedAt: iso(now, 15),
      statusCheckRollup: [check('test', null, 4, now), check('lint', 'SUCCESS', 4, now)],
      reviewRequests: [{ __typename: 'User', login: 'sam' }],
    }),
    base('acme/storefront', 39, {
      title: 'Cache product images at the edge',
      headRefName: 'perf/image-cache',
      author: { login: 'sam' },
      createdAt: iso(now, 60 * 6),
      updatedAt: iso(now, 45),
      requestedOfViewer: 'direct',
      statusCheckRollup: [check('test', 'SUCCESS', 50, now), check('lint', 'SUCCESS', 50, now)],
      reviewRequests: [{ __typename: 'User', login: VIEWER }],
      additions: 210,
      deletions: 35,
      changedFiles: 9,
    }),
    base('acme/billing-api', 15, {
      title: 'Move invoice numbering to the database',
      headRefName: 'invoice-sequence',
      author: { login: 'lee' },
      createdAt: iso(now, 60 * 30),
      updatedAt: iso(now, 60 * 3),
      reviewDecision: 'CHANGES_REQUESTED',
      latestReviews: [{ author: { login: 'sam' }, state: 'CHANGES_REQUESTED', submittedAt: iso(now, 60 * 3) }],
      requestedOfViewer: 'team',
      statusCheckRollup: [check('test', 'SUCCESS', 60 * 4, now)],
    }),
  ];
}
