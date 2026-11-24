/*
 * What the screenshots show. Each scene opens a page of the fixture world
 * (see fixture-data.mjs) and gets it into a state worth showing.
 *
 * When a change adds or reworks something on screen, add or update a scene
 * here so the PR preview and the release notes show it. Names are stable
 * keys: renaming one reads as a scene removed and a new one added.
 */

/**
 * A menu's button, by the start of its label. From the start, since hasText alone is a
 * case-insensitive substring: "Clean up" would also match "1 to clean up".
 */
const menuButton = (scope, label) => scope.locator('button[aria-haspopup="dialog"]', { hasText: new RegExp(`^${label}`) });

const settle = (page) => page.waitForLoadState('networkidle');

/**
 * The Agents page draws sessions first and their PR links once GitHub (here,
 * the fake gh) answers, so wait for both or captures race each other.
 */
async function agentsLoaded(page) {
  await page.getByText('Investigate the flaky invoice test').first().waitFor();
  await page.getByRole('link', { name: '#42', exact: true }).first().waitFor();
}

/** Show the Agents page in a theme, as the top-bar theme menu would choose it for this browser. */
function inTheme(theme, mode) {
  return async (page) => {
    await page.evaluate((choice) => localStorage.setItem('switchyard.appearance', JSON.stringify(choice)), { theme, mode });
    await page.reload();
    await agentsLoaded(page);
  };
}

/** The row of the session with this title. */
// A session or task row by its title: the innermost list item holding it, so a lead's row isn't taken for its worker's.
const rowOf = (page, title) => page.getByRole('listitem').filter({ hasText: title }).last();

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
    name: 'theme-menu',
    title: 'The theme menu: a theme, and light or dark, for this browser, or the Settings default',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await page.getByTitle('Theme, light or dark, and terminal colours for this browser').click();
    },
  },
  { name: 'theme-signal', title: 'Signal theme, dark: near-black, cyan, its own type', path: '/', prepare: inTheme('signal', 'dark') },
  { name: 'theme-signal-light', title: 'Signal theme, light', path: '/', prepare: inTheme('signal', 'light') },
  { name: 'theme-ember', title: 'Ember theme, light: warm paper with a copper accent', path: '/', prepare: inTheme('ember', 'light') },
  { name: 'theme-dusk', title: 'Dusk theme, dark: indigo with a violet accent', path: '/', prepare: inTheme('dusk', 'dark') },
  { name: 'theme-graphite', title: 'Graphite theme, light: monochrome and high-contrast', path: '/', prepare: inTheme('graphite', 'light') },
  { name: 'theme-coast', title: 'Coast theme, dark: a sunset drive, hot pink and sea teal over deep purple', path: '/', prepare: inTheme('coast', 'dark') },
  { name: 'theme-heatwave', title: 'Heatwave theme, dark: the whole sunset over deep violet, gradient buttons and the stripe', path: '/', prepare: inTheme('heatwave', 'dark') },
  { name: 'theme-heatwave-light', title: 'Heatwave theme, light: the hot afternoon', path: '/', prepare: inTheme('heatwave', 'light') },
  { name: 'theme-coast-light', title: 'Coast theme, light: warm peach, magenta and teal, with a sunset glow', path: '/', prepare: inTheme('coast', 'light') },
  {
    name: 'terminal-theme-dracula',
    title: 'Terminal colours: the glass panes in Dracula (the live terminal uses the same palette)',
    path: '/',
    prepare: async (page) => {
      await inTheme('classic', 'dark')(page);
      await page.evaluate(() => window.switchyardAppearance.choose({ terminal: 'dracula' }));
      await page.getByRole('button', { name: 'Review', exact: true }).first().click();
      await page.locator('dialog[open]').getByText(/^@@ /).first().waitFor();
    },
  },
  {
    name: 'terminal-theme-latte',
    title: 'Terminal colours: a light scheme (Catppuccin Latte) gives light glass',
    path: '/',
    prepare: async (page) => {
      await inTheme('classic', 'light')(page);
      await page.evaluate(() => window.switchyardAppearance.choose({ terminal: 'catppuccin-latte' }));
      await page.getByRole('button', { name: 'Review', exact: true }).first().click();
      await page.locator('dialog[open]').getByText(/^@@ /).first().waitFor();
    },
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
      await menuButton(page, 'New task').click();
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
      await menuButton(page, 'New task').click();
      await page.locator('select[name="repo"]').selectOption({ label: 'storefront' });
      await page.getByPlaceholder('What should Claude do?').fill('Show order history on the account page');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await rowOf(page, 'Starting…').waitFor();
    },
  },
  {
    name: 'review-pane',
    title: 'Review a permission prompt in full before answering it',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await page.getByRole('button', { name: 'Review', exact: true }).first().click();
      await page.locator('dialog[open]').waitFor();
      await settle(page);
    },
  },
  {
    name: 'answer',
    title: 'Answer a question Claude asks in tmux, from the page',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await menuButton(rowOf(page, 'Download invoices as PDF'), 'Answer').click();
      await page.locator('[data-radix-popper-content-wrapper] > *').filter({ visible: true }).waitFor();
    },
  },
  {
    name: 'plan',
    title: 'Read a plan in full, and approve it or say what to change',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await rowOf(page, 'Make the invoice total test deterministic').getByRole('button', { name: 'Plan', exact: true }).click();
      await page.locator('dialog[open]').waitFor();
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
      await menuButton(page, 'Clean up').first().click();
      await page.locator('[data-radix-popper-content-wrapper] > *').filter({ visible: true }).first().waitFor();
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
      // The repos for the GitHub issues list load after the rest.
      await page.locator('#issue-repos input[type="checkbox"]').first().waitFor();
    },
  },
  {
    name: 'session-graph',
    title: 'Graph: what a session brought into context — prompts, files, tools, memory, skills and subagents',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      const href = await rowOf(page, 'Retry failed charges with backoff').getByRole('link', { name: 'Graph' }).getAttribute('href');
      await page.goto(new URL(href, page.url()).href);
      await page.locator('#legend label').first().waitFor();
      await settle(page);
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
      await page.getByRole('region', { name: 'Needs you' }).waitFor();
    },
  },
  {
    name: 'tasks-mark-as',
    title: 'Mark as: close a task from its running session, or end just the session',
    path: '/tasks',
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      await menuButton(page.getByLabel('Work on this task').first(), 'Mark as').click();
      await page.locator('[data-radix-popper-content-wrapper]').getByRole('button', { name: 'End session' }).waitFor();
    },
  },
  {
    name: 'task-details',
    title: 'A task\'s details: edit it, read its ClickUp ticket and change its status',
    path: '/tasks',
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      await page.getByRole('button', { name: 'Download invoices as PDF', exact: true }).click();
      // The linked ticket, as ClickUp has it: its title comes with its description.
      await page.locator('dialog[open] article').getByRole('heading', { level: 3 }).waitFor();
      await settle(page);
    },
  },
  {
    name: 'tasks-add-from-clickup',
    title: 'Add from: make tasks from the tickets assigned to you, a tab per tracker',
    path: '/tasks',
    prepare: async (page) => {
      await page.getByText('Email a receipt after each charge').waitFor();
      await menuButton(page.getByRole('form', { name: 'Add a task' }), 'Add from').click();
      await page.locator('[data-radix-popper-content-wrapper] [role="menuitem"]').first().waitFor();
    },
  },
  {
    name: 'make-task',
    title: 'Make task: a task from a running session, filled in from it and linked to its branch',
    path: '/',
    prepare: async (page) => {
      await agentsLoaded(page);
      await rowOf(page, 'Fix the login redirect on the settings page').getByRole('button', { name: 'Make task', exact: true }).click();
      await page.locator('dialog[open] textarea[name=notes]').waitFor();
      await settle(page);
    },
  },
];
