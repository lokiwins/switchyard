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
  }),
  terminal: Object.freeze({
    // "auto" uses iTerm when switchyard was started from iTerm, otherwise Terminal; "none" hides terminal buttons.
    app: 'auto',
  }),
  editor: Object.freeze({
    // Folder links open as <scheme>://file/<path>: "vscode", "cursor", "vscode-insiders", or "none".
    urlScheme: 'vscode',
  }),
  agents: Object.freeze({
    parkedAfterHours: 24,
    endedHistoryDays: 7,
    interruptedAttentionDays: 3,
  }),
});

const SECTION_KEYS = {
  ci: ['holdPatterns', 'stripPrefixes'],
  git: ['longLivedBranches'],
  github: ['copilotReviewer'],
  terminal: ['app'],
  editor: ['urlScheme'],
  agents: ['parkedAfterHours', 'endedHistoryDays', 'interruptedAttentionDays'],
};
const TOP_LEVEL_KEYS = ['roots', 'port', 'claudeDir', ...Object.keys(SECTION_KEYS)];

export class SettingsError extends Error {}

const TERMINAL_CHOICES = ['auto', 'iTerm', 'Terminal', 'none'];

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

  if (!TERMINAL_CHOICES.includes(terminal.app)) fail('terminal.app', `must be one of: ${TERMINAL_CHOICES.join(', ')}`);
  if (typeof editor.urlScheme !== 'string' || !/^(none|[a-z][a-z0-9+.-]*)$/.test(editor.urlScheme)) {
    fail('editor.urlScheme', 'must be a URL scheme such as "vscode" or "cursor", or "none"');
  }

  if (typeof github.copilotReviewer !== 'string' || github.copilotReviewer === '') {
    fail('github.copilotReviewer', 'must be a non-empty string');
  }
  return {
    ci: {
      holdPatterns: compilePatterns(stringList(ci.holdPatterns, 'ci.holdPatterns'), 'ci.holdPatterns'),
      stripPrefixes: stringList(ci.stripPrefixes, 'ci.stripPrefixes'),
    },
    git: { isLongLivedBranch: branchMatcher(stringList(git.longLivedBranches, 'git.longLivedBranches')) },
    github: { copilotReviewer: github.copilotReviewer },
    terminal: { app: terminal.app },
    editor: { urlScheme: editor.urlScheme === 'none' ? null : editor.urlScheme },
    agents: {
      parkedAfterMs: positiveNumber(agents.parkedAfterHours, 'agents.parkedAfterHours') * HOUR_MS,
      endedHistoryMs: positiveNumber(agents.endedHistoryDays, 'agents.endedHistoryDays') * DAY_MS,
      interruptedAttentionMs: positiveNumber(agents.interruptedAttentionDays, 'agents.interruptedAttentionDays') * DAY_MS,
    },
  };
}

/** Settings with no config file at all; used as defaults throughout. */
export const DEFAULT_SETTINGS = parseSettings({});
