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
];
