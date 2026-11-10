/*
 * The files the pages load, by URL path. Only these are served from public/,
 * so a page module that isn't listed here fails to load (test/static-files
 * checks every import is).
 */
/** Pages hosting the live terminal, which get a style nonce on each load (see csp.js). */
export const STYLE_NONCE_PAGES = new Set(['agents.html', 'tasks.html']);

export const STATIC_FILES = {
  '/': 'agents.html',
  '/worktrees': 'worktrees.html',
  '/prs': 'prs.html',
  '/tasks': 'tasks.html',
  '/tasks.js': 'tasks.js',
  '/task-views.js': 'task-views.js',
  '/task-link-views.js': 'task-link-views.js',
  '/agents.js': 'agents.js',
  '/nav.js': 'nav.js',
  '/actions.js': 'actions.js',
  '/app.js': 'app.js',
  '/prs.js': 'prs.js',
  '/pr-views.js': 'pr-views.js',
  '/ended-views.js': 'ended-views.js',
  '/agent-views.js': 'agent-views.js',
  '/session-row.js': 'session-row.js',
  '/session-text.js': 'session-text.js',
  '/session-controls.js': 'session-controls.js',
  '/new-task.js': 'new-task.js',
  '/branch-name.js': 'branch-name.js',
  '/pending-tasks.js': 'pending-tasks.js',
  '/markdown.js': 'markdown.js',
  '/review-pane.js': 'review-pane.js',
  '/screen-answer.js': 'screen-answer.js',
  '/live-terminal.js': 'live-terminal.js',
  '/terminal-keys.js': 'terminal-keys.js',
  '/vendor/xterm/xterm.mjs': 'vendor/xterm/xterm.mjs',
  '/vendor/xterm/addon-fit.mjs': 'vendor/xterm/addon-fit.mjs',
  '/vendor/xterm/addon-webgl.mjs': 'vendor/xterm/addon-webgl.mjs',
  '/vendor/xterm/xterm.css': 'vendor/xterm/xterm.css',
  '/dom.js': 'dom.js',
  '/views.js': 'views.js',
  '/styles.css': 'styles.css',
};
