/*
 * What the screenshots show. Each scene opens a page of the fixture world
 * (see fixture-data.mjs) and gets it into a state worth showing.
 *
 * When a change adds or reworks something on screen, add or update a scene
 * here so the PR preview and the release notes show it. Names are stable
 * keys: renaming one reads as a scene removed and a new one added.
 */

const settle = (page) => page.waitForLoadState('networkidle');

/** @type {{ name: string, title: string, path: string, fullPage?: boolean, prepare?: (page: import('playwright').Page) => Promise<void> }[]} */
export const SCENES = [
  {
    name: 'agents',
    title: 'Agents: running sessions and what they are doing',
    path: '/',
    fullPage: true,
    prepare: async (page) => {
      await page.getByText('Fix the login redirect on the settings page').first().waitFor();
      await page.getByText('Investigate the flaky invoice test').first().waitFor();
    },
  },
  {
    name: 'new-task',
    title: 'New task: start Claude on a task in its own worktree',
    path: '/',
    prepare: async (page) => {
      await page.locator('summary', { hasText: 'New task' }).click();
      await page.getByPlaceholder('What should Claude do?').fill('Show order history on the account page');
    },
  },
  {
    name: 'review-pane',
    title: 'Review a permission prompt in full before answering it',
    path: '/',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Review', exact: true }).first().click();
      await page.locator('dialog.review-pane[open]').waitFor();
      await settle(page);
    },
  },
  {
    name: 'worktrees',
    title: 'Worktrees: every checkout, its branch, PR and sessions',
    path: '/worktrees',
    fullPage: true,
    prepare: async (page) => {
      await page.getByText('storefront-dark-mode').first().waitFor();
    },
  },
  {
    name: 'clean-up',
    title: 'Clean up a worktree whose PR has merged',
    path: '/worktrees',
    prepare: async (page) => {
      await page.locator('summary', { hasText: 'Clean up' }).first().click();
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
];
