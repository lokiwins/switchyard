/*
 * What the screenshots show. Each scene opens a page of the fixture world
 * (see fixture-data.mjs) and gets it into a state worth showing.
 *
 * When a change adds or reworks something on screen, add or update a scene
 * here so the PR preview and the release notes show it. Names are stable
 * keys: renaming one reads as a scene removed and a new one added.
 */

// Menus are <details class="menu"> whose <summary> is the button. Match the label from its
// start: hasText alone is a case-insensitive substring, so "Clean up" would also match "1 to clean up".
const settle = (page) => page.waitForLoadState('networkidle');

/**
 * The Agents page draws sessions first and their PR links once GitHub (here,
 * the fake gh) answers, so wait for both or captures race each other.
 */
async function agentsLoaded(page) {
  await page.getByText('Investigate the flaky invoice test').first().waitFor();
  await page.getByRole('link', { name: '#42', exact: true }).first().waitFor();
}

/** The row of the session with this title. */
const rowOf = (page, title) => page.locator('li.list-row', { hasText: title });

/** @type {{ name: string, title: string, path: string, fullPage?: boolean, prepare?: (page: import('playwright').Page) => Promise<void> }[]} */
export const SCENES = [
  {
    name: 'agents',
    title: 'Agents: running sessions and what they are doing',
    path: '/',
    fullPage: true,
    prepare: agentsLoaded,
  },
  {
    name: 'agents-phone',
    title: 'Agents on a phone: the top bar in two rows, nothing wider than the screen',
    path: '/',
    prepare: async (page) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await agentsLoaded(page);
    },
  },
  {
    name: 'new-task',
    title: 'New task: start Claude on a task in its own worktree',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await page.locator('details.menu > summary', { hasText: /^New task/ }).click();
      await page.getByPlaceholder('What should Claude do?').fill('Show order history on the account page');
    },
  },
  {
    name: 'new-task-starting',
    title: 'New task: a row for the task at once, until its Claude session shows up',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      // Answer as the server does once the worktree is made, without starting Claude in the fixtures' tmux.
      await page.route('**/api/tasks/new', (route) => route.fulfill({
        json: {
          success: true,
          data: {
            path: '/home/dev/code/storefront-order-history', branch: 'order-history', session: 'switchyard', window: 'storefront-order-history',
          },
        },
      }));
      await page.locator('details.menu > summary', { hasText: /^New task/ }).click();
      await page.locator('select[name="repo"]').selectOption({ label: 'storefront' });
      await page.getByPlaceholder('What should Claude do?').fill('Show order history on the account page');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.locator('li.list-row.is-pending .pill', { hasText: 'Starting…' }).waitFor();
    },
  },
  {
    name: 'review-pane',
    title: 'Review a permission prompt in full before answering it',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await page.getByRole('button', { name: 'Review', exact: true }).first().click();
      await page.locator('dialog.review-pane[open]').waitFor();
      await settle(page);
    },
  },
  {
    name: 'answer',
    title: 'Answer a question Claude asks in tmux, from the page',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await rowOf(page, 'Download invoices as PDF').locator('details.menu > summary', { hasText: /^Answer/ }).click();
      await page.locator('.answer-panel').filter({ visible: true }).waitFor();
    },
  },
  {
    name: 'plan',
    title: 'Read a plan in full, and approve it or say what to change',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await rowOf(page, 'Make the invoice total test deterministic').getByRole('button', { name: 'Plan', exact: true }).click();
      await page.locator('dialog.plan-pane[open]').waitFor();
    },
  },
  {
    name: 'worktrees',
    title: 'Worktrees: every checkout, its branch, PR and sessions',
    path: '/worktrees',
    fullPage: true,
    prepare: async (page) => {
      await page.getByText('chore/remove-banner').first().waitFor();
      await page.getByRole('link', { name: '#42', exact: true }).first().waitFor();
    },
  },
  {
    name: 'clean-up',
    title: 'Clean up a worktree whose PR has merged',
    path: '/worktrees',
    prepare: async (page) => {
      await page.getByRole('link', { name: '#42', exact: true }).first().waitFor();
      await page.locator('details.menu > summary', { hasText: /^Clean up/ }).first().click();
      await page.getByRole('menu').filter({ visible: true }).first().waitFor();
    },
  },
  {
    name: 'pull-requests',
    title: 'Pull requests: yours and the ones waiting on your review',
    path: '/prs',
    fullPage: true,
    prepare: async (page) => {
      await page.getByText('Add a dark mode toggle').first().waitFor();
      await page.getByText('Cache product images at the edge').first().waitFor();
    },
  },
  {
    name: 'settings',
    title: 'Settings: change switchyard\'s options from the page; they apply at once',
    path: '/settings',
    fullPage: true,
    prepare: async (page) => {
      await page.locator('#facts dd').first().waitFor();
    },
  },
  {
    name: 'tasks',
    title: 'Tasks: your own tasks, what needs you first, then by when each is due',
    path: '/tasks',
    fullPage: true,
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      // The work under the tasks: worktrees, the PR and Terminal/Jump on the running sessions.
      await page.getByRole('link', { name: '#42', exact: true }).waitFor();
      await page.locator('.hub-group.is-needs-you').waitFor();
    },
  },
  {
    name: 'task-details',
    title: 'A task\'s details: edit it, read its ClickUp ticket and change its status',
    path: '/tasks',
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      await page.getByRole('button', { name: 'Download invoices as PDF', exact: true }).click();
      await page.locator('dialog.task-pane[open] .pane-ticket .markdown').waitFor();
      await settle(page);
    },
  },
  {
    name: 'tasks-add-from-clickup',
    title: 'Add from: make tasks from the tickets assigned to you, a tab per tracker',
    path: '/tasks',
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      await page.locator('form.hub-new details.menu > summary', { hasText: /^Add from/ }).click();
      await page.locator('.picker-panel .picker-item').first().waitFor();
    },
  },
];
