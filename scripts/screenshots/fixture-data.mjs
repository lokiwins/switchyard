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
      { suffix: 'dark-mode', branch: 'feat/CU-86b4fx3-dark-mode', commitMinutesAgo: 90 },
      { suffix: 'remove-banner', branch: 'chore/remove-banner', commitMinutesAgo: 60 * 30 },
    ],
  },
  {
    name: 'billing-api',
    github: 'acme/billing-api',
    files: { 'README.md': '# billing-api\n', 'src/retry.js': 'export const MAX_RETRIES = 3;\n' },
    worktrees: [
      { suffix: 'retry-backoff', branch: 'feat/retry-backoff', commitMinutesAgo: 25 },
      { suffix: 'invoice-pdf', branch: 'feat/CU-86b4fx1-invoice-pdf', commitMinutesAgo: 15 },
    ],
  },
];

const THEME_FILE = 'src/theme.css';

// Dialogs as Claude Code draws them in a tmux pane (see src/agents/screen-prompt.js).
const RULE = '─'.repeat(100);
const DASHES = '╌'.repeat(100);

const QUESTION_SCREEN = [
  '⏺ Before I lay out the PDF, one thing to settle:',
  '',
  RULE,
  ' ☐ Paper size',
  '',
  'Which paper size should invoice PDFs use?',
  '',
  '❯ 1. A4',
  '     The standard size almost everywhere outside North America.',
  '  2. US Letter',
  '     The standard size in the US and Canada.',
  "  3. Match the customer's country",
  "     A4 or Letter, picked from the billing address.",
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
];

export const PLAN_FILE = 'deterministic-invoice-total.md';

export const PLAN = `# Make the invoice total test deterministic

The test fails about one run in ten because line items are summed in the order the
database returns them, and floating-point addition isn't associative.

## Steps

1. Store amounts as integer cents in \`src/invoice.js\` instead of floats.
2. Sum line items in cents and format the total only for display.
3. Seed the test's line items in a fixed order and assert on cents.
4. Run the invoice tests 200 times in a loop to check the flake is gone.
`;

const PLAN_SCREEN = [
  " Here is Claude's plan:",
  DASHES,
  ' Make the invoice total test deterministic',
  '',
  ' 1. Store amounts as integer cents in src/invoice.js instead of floats.',
  ' 2. Sum line items in cents and format the total only for display.',
  DASHES,
  '',
  RULE,
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  ' ❯ 1. Yes, and use auto mode',
  '   2. Yes, manually approve edits',
  '   3. Tell Claude what to change',
  '      shift+tab to approve with this feedback',
  '',
  ' ctrl+g to edit in VS Code ·',
  ` ~/.claude/plans/${PLAN_FILE}`,
];

/**
 * Claude Code sessions. `status` makes one running (a live process is started
 * for it); without it the session has ended. `worktree` is "<repo>" or
 * "<repo>-<suffix>". `screen` runs it in a tmux pane showing those lines,
 * so the page can read and answer the dialog on it.
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
    worktree: 'billing-api-invoice-pdf',
    status: 'waiting',
    title: 'Download invoices as PDF',
    minutesAgo: 2,
    screen: QUESTION_SCREEN,
    turns: [
      { prompt: 'Let customers download each invoice as a PDF from the invoice page.' },
      { reply: 'I\'ll render invoices with the existing template. Asking which paper size to use.' },
    ],
  },
  {
    worktree: 'billing-api',
    status: 'waiting',
    title: 'Make the invoice total test deterministic',
    minutesAgo: 4,
    screen: PLAN_SCREEN,
    turns: [
      { prompt: 'The invoice total test is still flaky. Plan a fix before changing anything.' },
      { reply: 'Found it: totals are summed as floats in database order. Here is a plan.' },
    ],
  },
  {
    worktree: 'storefront',
    status: 'waiting',
    title: 'Bump the image library',
    minutesAgo: 6,
    turns: [
      { prompt: 'Bump the image library to the latest minor version.' },
      { reply: 'The upgrade touches the lockfile. Asking before I run the install.' },
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
      headRefName: 'feat/CU-86b4fx3-dark-mode',
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

/** ClickUp, as the stand-in in fake-clickup.mjs answers: you, your workspace, and tasks assigned to you. */
export const CLICKUP = {
  token: 'pk_1000001_FIXTUREFIXTUREFIXTUREFIXTURE00',
  user: { id: 1000001, username: VIEWER },
  workspaces: [{ id: '9001', name: 'Acme' }],
};

const clickupTask = (now, {
  id, customId = null, name, status, color, type = 'custom', priority, dueDays, updatedMinutes, list, folder,
}) => ({
  id,
  custom_id: customId,
  name,
  status: { status, color, type },
  priority: priority ? { priority } : null,
  due_date: dueDays === undefined ? null : String(now + dueDays * 24 * 60 * 60_000),
  date_updated: String(now - updatedMinutes * 60_000),
  url: `https://app.clickup.com/t/${id}`,
  list: { id: '1', name: list },
  folder: folder ? { id: '2', name: folder, hidden: false } : { id: '3', name: 'hidden', hidden: true },
});

/** The statuses every fixture list has, as ClickUp's list endpoint gives them. */
export const CLICKUP_STATUSES = [
  { status: 'to do', color: '#87909e', type: 'open', orderindex: 0 },
  { status: 'in progress', color: '#4194f6', type: 'custom', orderindex: 1 },
  { status: 'in review', color: '#a875ff', type: 'custom', orderindex: 2 },
  { status: 'complete', color: '#6bc950', type: 'closed', orderindex: 3 },
];

/** What a few tickets say, in ClickUp's Markdown. */
export const CLICKUP_DESCRIPTIONS = {
  '86b4fx1': '## Goal\nA **Download PDF** button on each invoice.\n\n- Rendered on the server\n- Same layout as the email\n\nAcceptance: the PDF matches the invoice page to the cent.',
  '86b4fx5': 'Send a receipt by email after each successful charge, with the amount and the last four digits of the card.',
};

/** Issues the stand-in gh knows: for the details pane, and (assigned to you, open) for Add from ▾. */
export const ISSUES = [
  {
    repo: 'acme/storefront', number: 51, title: 'CI takes 14 minutes on every push', state: 'OPEN', url: 'https://github.com/acme/storefront/issues/51',
    body: 'Most of it is `npm ci` and the two slow suites.\n\n- Cache `node_modules`\n- Split the e2e suite', assignees: [VIEWER], updatedAt: '2026-11-09T15:00:00Z',
  },
  {
    repo: 'acme/billing-api', number: 12, title: 'Refunds should email the customer', state: 'OPEN', url: 'https://github.com/acme/billing-api/issues/12',
    body: 'Today a refund is silent. Send the same receipt email, marked **Refund**.', assignees: [VIEWER], updatedAt: '2026-11-10T08:30:00Z',
  },
  {
    repo: 'acme/storefront', number: 58, title: 'Search loses its filter on Back', state: 'OPEN', url: 'https://github.com/acme/storefront/issues/58',
    body: 'Going back to search results drops the category filter.', assignees: [VIEWER], updatedAt: '2026-11-10T11:00:00Z',
  },
  {
    repo: 'acme/storefront', number: 60, title: 'Someone else\'s issue', state: 'OPEN', url: 'https://github.com/acme/storefront/issues/60',
    body: '', assignees: ['sam'], updatedAt: '2026-11-10T12:00:00Z',
  },
];

/** Open tasks assigned to you, in ClickUp's own shape, most recently updated first. */
export function clickupTasks(now) {
  return [
    { id: '86b4fx1', name: 'Download invoices as PDF', status: 'in progress', color: '#4194f6', priority: 'high', dueDays: 1, updatedMinutes: 2, list: 'Sprint 12', folder: 'Billing' },
    { id: '86b4fx2', name: 'Make the invoice total test deterministic', status: 'in review', color: '#a875ff', priority: 'urgent', dueDays: -2, updatedMinutes: 4, list: 'Sprint 12', folder: 'Billing' },
    { id: '86b4fx3', name: 'Add a dark mode toggle', status: 'in progress', color: '#4194f6', priority: 'normal', dueDays: 6, updatedMinutes: 20, list: 'Sprint 12', folder: 'Storefront' },
    { id: '86b4fx4', name: 'Show order history on the account page', status: 'to do', color: '#87909e', priority: 'normal', dueDays: 12, updatedMinutes: 60 * 5, list: 'Backlog', folder: 'Storefront' },
    { id: '86b4fx5', name: 'Email a receipt after each charge', status: 'to do', color: '#87909e', priority: 'low', updatedMinutes: 60 * 26, list: 'Ideas' },
    // Not linked from any of your tasks yet: what Add from ClickUp offers.
    { id: '86b4fx6', name: 'Speed up the product search', status: 'to do', color: '#87909e', priority: 'high', dueDays: 4, updatedMinutes: 60 * 30, list: 'Sprint 13', folder: 'Storefront' },
    { id: '86b4fx7', customId: 'SHOP-31', name: 'Show stock levels on product cards', status: 'in progress', color: '#4194f6', priority: 'normal', updatedMinutes: 60 * 40, list: 'Sprint 13', folder: 'Storefront' },
  ].map((task) => clickupTask(now, task));
}

const DAY = 24 * 60 * 60_000;
// A day as the Tasks page stores it, in UTC (the screenshots' timezone).
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);

/**
 * Your own tasks on the Tasks page, as ~/.config/switchyard/tasks.json holds
 * them, newest first. The ones linking a ClickUp ticket find their worktree by
 * the CU-<id> in its branch.
 */
export function hubTasks(now) {
  const clickup = (id) => `https://app.clickup.com/t/${id}`;
  const task = ({ id, title, notes = '', dueDays, links = [], createdHours, closedHoursAgo }) => ({
    id,
    title,
    notes,
    dueOn: dueDays === undefined ? null : dayOf(now + dueDays * DAY),
    links,
    createdAt: now - createdHours * 60 * 60_000,
    updatedAt: now - createdHours * 60 * 60_000,
    closedAs: closedHoursAgo === undefined ? null : 'done',
    closedAt: closedHoursAgo === undefined ? null : now - closedHoursAgo * 60 * 60_000,
  });
  return [
    task({ id: 'sy-spike1', title: 'Spike: run CI in half the time', notes: 'Try caching node_modules and splitting the slow suites.', links: ['https://github.com/acme/storefront/issues/51'], createdHours: 2 }),
    task({ id: 'sy-inv001', title: 'Download invoices as PDF', notes: 'Add a Download PDF button to each invoice, rendered server-side.', dueDays: 0, links: [clickup('86b4fx1')], createdHours: 30 }),
    task({ id: 'sy-dark01', title: 'Add a dark mode toggle', notes: 'Follow the system setting by default; remember a choice.', dueDays: 3, links: [clickup('86b4fx3')], createdHours: 50 }),
    task({ id: 'sy-test01', title: 'Make the invoice total test deterministic', dueDays: -2, links: [clickup('86b4fx2')], createdHours: 70 }),
    task({ id: 'sy-hist01', title: 'Show order history on the account page', dueDays: 12, links: [clickup('86b4fx4')], createdHours: 90 }),
    task({ id: 'sy-rcpt01', title: 'Email a receipt after each charge', links: [clickup('86b4fx5')], createdHours: 120 }),
    task({ id: 'sy-bann01', title: 'Remove the holiday banner', createdHours: 200, closedHoursAgo: 20 }),
  ];
}
