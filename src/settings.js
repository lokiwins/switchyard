import { MODE_IDS, THEME_IDS } from '../public/themes.js';
import { TERMINAL_IDS } from '../public/terminal-themes.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Generic defaults. Workplace-specific values (your CI's approval job names,
 * your team's long-lived branches) belong in the gitignored config.json.
 */
export const DEFAULTS = Object.freeze({
  ci: Object.freeze({
    // Manual approval jobs stay "pending" until someone approves them, as do jobs queued behind them.
    holdPatterns: Object.freeze(['\\b(hold|approve|approval)\\b', '_hold\\b', '^hold_']),
    // Removed from check names when displayed, e.g. "ci/circleci: build/test" -> "build/test".
    stripPrefixes: Object.freeze(['ci/circleci: ']),
  }),
  git: Object.freeze({
    // Branch names that PRs from forks or other teams often reuse; never matched to a worktree. "*" is a wildcard.
    longLivedBranches: Object.freeze(['main', 'master', 'develop', 'dev', 'trunk']),
  }),
  github: Object.freeze({
    copilotReviewer: 'copilot-pull-request-reviewer[bot]',
    // The repos (owner/repo) the Tasks page's GitHub issues list shows; empty shows every repo.
    issueRepos: Object.freeze([]),
  }),
  terminal: Object.freeze({
    // "auto" uses iTerm when switchyard was started from iTerm, otherwise Terminal; "none" hides terminal buttons.
    app: 'auto',
  }),
  editor: Object.freeze({
    // Folder links open as <scheme>://file/<path>: "vscode", "cursor", "vscode-insiders", or "none".
    urlScheme: 'vscode',
  }),
  appearance: Object.freeze({
    // The theme and light/dark mode every browser starts with; each browser can choose its own in the top bar.
    theme: 'classic',
    mode: 'system',
    // The live terminal's colours: "match" uses the page theme's own, or a named scheme such as "nord".
    terminal: 'match',
  }),
  agents: Object.freeze({
    parkedAfterHours: 24,
    endedHistoryDays: 7,
    interruptedAttentionDays: 3,
  }),
  tasks: Object.freeze({
    // Delete done and dropped tasks this many days after they're done, putting their work away (see task-cleanup.js).
    autoDeleteDone: false,
    deleteDoneAfterDays: 7,
  }),
});

const SECTION_KEYS = {
  ci: ['holdPatterns', 'stripPrefixes'],
  git: ['longLivedBranches'],
  github: ['copilotReviewer', 'issueRepos'],
  terminal: ['app'],
  editor: ['urlScheme'],
  appearance: ['theme', 'mode', 'terminal'],
  agents: ['parkedAfterHours', 'endedHistoryDays', 'interruptedAttentionDays'],
  tasks: ['autoDeleteDone', 'deleteDoneAfterDays'],
};
const TOP_LEVEL_KEYS = ['roots', 'port', 'claudeDir', ...Object.keys(SECTION_KEYS)];

export class SettingsError extends Error {}

const TERMINAL_CHOICES = ['auto', 'iTerm', 'Terminal', 'none'];
// owner/repo, as GitHub allows them: letters, digits, '-', '_' and '.'.
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Resolve terminal.app "auto" from the terminal switchyard was launched in. */
export function resolveTerminalApp(app, env = process.env) {
  if (app !== 'auto') return app === 'none' ? null : app;
  return env.TERM_PROGRAM === 'iTerm.app' ? 'iTerm' : 'Terminal';
}

function fail(path, message) {
  throw new SettingsError(`config.json: "${path}" ${message}`);
}

function checkKeys(object, allowed, prefix) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${prefix}${key}`, `is not a known setting (expected one of: ${allowed.join(', ')})`);
  }
}

function stringList(value, path) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '')) {
    fail(path, 'must be an array of non-empty strings');
  }
  return value;
}

function positiveNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(path, 'must be a positive number');
  return value;
}

function compilePatterns(patterns, path) {
  return patterns.map((source, i) => {
    try {
      return new RegExp(source, 'i');
    } catch (error) {
      return fail(`${path}[${i}]`, `is not a valid regular expression: ${error.message}`);
    }
  });
}

/** Turn "release/*" style globs into a single matcher. */
export function branchMatcher(globs) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const exact = new Set(globs.filter((g) => !g.includes('*')));
  const wildcards = globs.filter((g) => g.includes('*'))
    .map((g) => new RegExp(`^${g.split('*').map(escape).join('.*')}$`));
  return (branch) => exact.has(branch) || wildcards.some((re) => re.test(branch));
}

function section(file, name) {
  const value = file[name] ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) fail(name, 'must be an object');
  checkKeys(value, SECTION_KEYS[name], `${name}.`);
  return { ...DEFAULTS[name], ...value };
}

/**
 * Validate the parsed config file and resolve every workplace-specific
 * setting. Values replace defaults key by key; lists are replaced, not merged.
 */
export function parseSettings(file = {}) {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    throw new SettingsError('config.json must contain a JSON object');
  }
  checkKeys(file, TOP_LEVEL_KEYS, '');
  if (file.roots !== undefined) stringList(file.roots, 'roots');
  if (file.port !== undefined && (!Number.isInteger(file.port) || file.port <= 0)) fail('port', 'must be a positive integer');
  if (file.claudeDir !== undefined && (typeof file.claudeDir !== 'string' || file.claudeDir === '')) {
    fail('claudeDir', 'must be a non-empty string');
  }
  const ci = section(file, 'ci');
  const git = section(file, 'git');
  const github = section(file, 'github');
  const agents = section(file, 'agents');
  const terminal = section(file, 'terminal');
  const editor = section(file, 'editor');
  const appearance = section(file, 'appearance');
  const tasks = section(file, 'tasks');
  if (typeof tasks.autoDeleteDone !== 'boolean') fail('tasks.autoDeleteDone', 'must be true or false');

  if (!TERMINAL_CHOICES.includes(terminal.app)) fail('terminal.app', `must be one of: ${TERMINAL_CHOICES.join(', ')}`);
  if (typeof editor.urlScheme !== 'string' || !/^(none|[a-z][a-z0-9+.-]*)$/.test(editor.urlScheme)) {
    fail('editor.urlScheme', 'must be a URL scheme such as "vscode" or "cursor", or "none"');
  }

  if (!THEME_IDS.includes(appearance.theme)) fail('appearance.theme', `must be one of: ${THEME_IDS.join(', ')}`);
  if (!MODE_IDS.includes(appearance.mode)) fail('appearance.mode', `must be one of: ${MODE_IDS.join(', ')}`);
  if (!TERMINAL_IDS.includes(appearance.terminal)) fail('appearance.terminal', `must be one of: ${TERMINAL_IDS.join(', ')}`);
  if (typeof github.copilotReviewer !== 'string' || github.copilotReviewer === '') {
    fail('github.copilotReviewer', 'must be a non-empty string');
  }
  const issueRepos = github.issueRepos;
  if (!Array.isArray(issueRepos) || issueRepos.some((name) => typeof name !== 'string' || !GITHUB_REPO.test(name))) {
    fail('github.issueRepos', 'must be a list of repos written as owner/repo');
  }
  return {
    ci: {
      holdPatterns: compilePatterns(stringList(ci.holdPatterns, 'ci.holdPatterns'), 'ci.holdPatterns'),
      stripPrefixes: stringList(ci.stripPrefixes, 'ci.stripPrefixes'),
    },
    git: { isLongLivedBranch: branchMatcher(stringList(git.longLivedBranches, 'git.longLivedBranches')) },
    github: { copilotReviewer: github.copilotReviewer, issueRepos: [...issueRepos] },
    terminal: { app: terminal.app },
    editor: { urlScheme: editor.urlScheme === 'none' ? null : editor.urlScheme },
    appearance: { theme: appearance.theme, mode: appearance.mode, terminal: appearance.terminal },
    agents: {
      parkedAfterMs: positiveNumber(agents.parkedAfterHours, 'agents.parkedAfterHours') * HOUR_MS,
      endedHistoryMs: positiveNumber(agents.endedHistoryDays, 'agents.endedHistoryDays') * DAY_MS,
      interruptedAttentionMs: positiveNumber(agents.interruptedAttentionDays, 'agents.interruptedAttentionDays') * DAY_MS,
    },
    tasks: {
      autoDeleteDone: tasks.autoDeleteDone,
      deleteDoneAfterMs: positiveNumber(tasks.deleteDoneAfterDays, 'tasks.deleteDoneAfterDays') * DAY_MS,
    },
  };
}

/** Settings with no config file at all; used as defaults throughout. */
export const DEFAULT_SETTINGS = parseSettings({});
