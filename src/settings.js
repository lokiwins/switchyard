import { MODE_IDS, THEME_IDS } from '../public/themes.js';
import { TERMINAL_IDS } from '../public/terminal-themes.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

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
    // The most agents running at once; switchyard refuses to start one more (see agent-limit.js). 0 is no limit.
    maxRunning: 0,
    // A session working with nothing new for this long is flagged as stuck (see stuck.js); 0 is off.
    stuckAfterMinutes: 30,
    // A session whose context is over this many tokens is flagged; 0 is off.
    contextAlertTokens: 0,
  }),
  tasks: Object.freeze({
    // Delete done and dropped tasks this many days after they're done, putting their work away (see task-cleanup.js).
    autoDeleteDone: false,
    deleteDoneAfterDays: 7,
  }),
  checks: Object.freeze({
    // Each repo's named checks, run in a worktree of it: { "billing-api": { "lint": "npm run lint", "test": "npm test" } }.
    commands: Object.freeze({}),
    // A check still running after this long is stopped, and counts as failed.
    timeoutMinutes: 10,
  }),
  // The workers a lead starts (see lead-tools.js), set as each one starts.
  workers: Object.freeze({
    // The permission mode they start in; "claude" adds none, so they start as your Claude settings say.
    permissionMode: 'claude',
    // Permission rules they may use without asking, such as "Bash(npm test)" or "Edit".
    allowedTools: Object.freeze([]),
  }),
  // The agent CLIs (see src/agents/providers.js): which one is used when none is named, and how each is run.
  providers: Object.freeze({
    default: 'claude',
    claude: Object.freeze({
      enabled: true,
      // A name found on PATH, or a full path (~/ allowed).
      program: 'claude',
      // Added to every new and resumed session, e.g. "--model opus".
      options: '',
    }),
  }),
});

const SECTION_KEYS = {
  ci: ['holdPatterns', 'stripPrefixes'],
  git: ['longLivedBranches'],
  github: ['copilotReviewer', 'issueRepos'],
  terminal: ['app'],
  editor: ['urlScheme'],
  appearance: ['theme', 'mode', 'terminal'],
  agents: ['parkedAfterHours', 'endedHistoryDays', 'interruptedAttentionDays', 'maxRunning', 'stuckAfterMinutes', 'contextAlertTokens'],
  tasks: ['autoDeleteDone', 'deleteDoneAfterDays'],
  checks: ['commands', 'timeoutMinutes'],
  // leadWithoutAsking is no longer used (a lead uses switchyard's tools without asking), but still read, so an older file loads.
  workers: ['permissionMode', 'allowedTools', 'leadWithoutAsking'],
  providers: ['default', ...Object.keys(DEFAULTS.providers).filter((key) => key !== 'default')],
};
const PROVIDER_IDS = SECTION_KEYS.providers.slice(1);
const PROVIDER_KEYS = ['enabled', 'program', 'options'];
// A program: a bare name found on PATH, or a full path; letters, digits and . _ - / only, so it's typed as is.
const PROGRAM = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*|(?:~|)\/[A-Za-z0-9._\/-]+)$/;
// An option is a plain word: nothing a shell would treat as quoting, expansion or another command.
const OPTION_WORD = /^[A-Za-z0-9_@%+=:,.\/~-]+$/;
const MAX_OPTIONS_LENGTH = 500;
// A repo's folder name, or a check's name: no spaces, as both are typed as keys.
const CHECK_NAME = /^[A-Za-z0-9._-]{1,64}$/;
// The earlier one-line form, "repo: command", still read.
const CHECK_LINE = /^\s*([A-Za-z0-9._-]+)\s*:\s*(\S.*?)\s*$/;
// A repo given just a command has one check, called this.
const SINGLE_CHECK = 'check';
const MAX_CHECK_COMMAND = 2000;
const MAX_CHECKS_PER_REPO = 20;
const MAX_CHECK_MINUTES = 120;
// When a check runs by itself (see check-triggers.js): never, after an agent's turn, or on a new commit.
export const CHECK_RUNS = ['manual', 'after-turn', 'on-commit'];
const CHECK_OPTIONS = ['command', 'run', 'timeout'];

/** The earlier ["repo: command", …] lines, as { repo: command }. */
function fromLines(lines) {
  const commands = {};
  for (const line of stringList(lines, 'checks.commands')) {
    const [, repo, command] = CHECK_LINE.exec(line) ?? [];
    if (!repo) fail('checks.commands', `must give each repo its checks, such as "billing-api: npm test" (got ${JSON.stringify(line)})`);
    if (Object.hasOwn(commands, repo)) fail('checks.commands', `names ${repo} twice`);
    commands[repo] = command;
  }
  return commands;
}

function checkCommand(value, where) {
  if (typeof value !== 'string' || value.trim() === '') fail('checks.commands', `has no command for ${where}`);
  if (value.length > MAX_CHECK_COMMAND) fail('checks.commands', `has a command for ${where} longer than ${MAX_CHECK_COMMAND} characters`);
  return value.trim();
}

/** A check: just its command, or { command, run?, timeout? (minutes) }. */
function checkOptions(value, where) {
  if (typeof value === 'string') return { command: checkCommand(value, where), run: 'manual', timeoutMs: null };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('checks.commands', `has no command for ${where}`);
  const unknown = Object.keys(value).filter((key) => !CHECK_OPTIONS.includes(key));
  if (unknown.length > 0) fail('checks.commands', `gives ${where} ${unknown.join(', ')}; a check takes ${CHECK_OPTIONS.join(', ')}`);
  const run = value.run ?? 'manual';
  if (!CHECK_RUNS.includes(run)) fail('checks.commands', `gives ${where} run: ${JSON.stringify(run)}; use ${CHECK_RUNS.join(', ')}`);
  let timeoutMs = null;
  if (value.timeout !== undefined) {
    if (typeof value.timeout !== 'number' || !(value.timeout > 0) || value.timeout > MAX_CHECK_MINUTES) {
      fail('checks.commands', `gives ${where} a timeout that isn't a number of minutes from 0 to ${MAX_CHECK_MINUTES}`);
    }
    timeoutMs = value.timeout * MINUTE_MS;
  }
  return { command: checkCommand(value.command, where), run, timeoutMs };
}

/** { repo: { name: command | { command, run, timeout } } | command } as { repo: [{ name, command, run, timeoutMs }] }, in the order written. */
function checkCommands(value) {
  const byRepo = Array.isArray(value) ? fromLines(value) : value;
  if (typeof byRepo !== 'object' || byRepo === null) fail('checks.commands', 'must give each repo its checks, such as { "billing-api": { "test": "npm test" } }');
  return Object.fromEntries(Object.entries(byRepo).map(([repo, checks]) => {
    if (!CHECK_NAME.test(repo)) fail('checks.commands', `has ${JSON.stringify(repo)}, which isn't a repo folder name`);
    if (typeof checks === 'string') return [repo, [{ name: SINGLE_CHECK, ...checkOptions(checks, repo) }]];
    if (typeof checks !== 'object' || checks === null || Array.isArray(checks)) fail('checks.commands', `must give ${repo} named checks, such as test: npm test`);
    const entries = Object.entries(checks);
    if (entries.length === 0) fail('checks.commands', `gives ${repo} no checks`);
    if (entries.length > MAX_CHECKS_PER_REPO) fail('checks.commands', `gives ${repo} more than ${MAX_CHECKS_PER_REPO} checks`);
    return [repo, entries.map(([name, command]) => {
      if (!CHECK_NAME.test(name)) fail('checks.commands', `has a check called ${JSON.stringify(name)} for ${repo}; use letters, digits, ".", "_" and "-"`);
      return { name, ...checkOptions(command, `${repo} ${name}`) };
    })];
  }));
}
// A worker's permission modes: Claude's own default, or one of Claude's that still leaves you a say (no bypassPermissions or dontAsk).
export const WORKER_MODES = ['claude', 'manual', 'acceptEdits', 'plan', 'auto'];
// A permission rule: a tool's name, maybe with what it may do in brackets, like "Bash(npm test)" or "mcp__github__get_issue".
const TOOL_RULE = /^[A-Za-z_][A-Za-z0-9_-]*(?:\([^()\n]+\))?$/;
const MAX_TOOL_RULE = 300;
const MAX_TOOL_RULES = 100;

function workerSettings(workers) {
  if (!WORKER_MODES.includes(workers.permissionMode)) fail('workers.permissionMode', `must be one of: ${WORKER_MODES.join(', ')}`);
  const rules = workers.allowedTools;
  if (!Array.isArray(rules) || rules.length > MAX_TOOL_RULES || rules.some((rule) => typeof rule !== 'string' || rule.length > MAX_TOOL_RULE || !TOOL_RULE.test(rule))) {
    fail('workers.allowedTools', `must be a list of up to ${MAX_TOOL_RULES} permission rules such as "Edit" or "Bash(npm test)"`);
  }
  return { permissionMode: workers.permissionMode, allowedTools: [...rules] };
}

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

const MAX_RUNNING_LIMIT = 100;

/** How many agents may run at once: a whole number, 0 for no limit. */
function runningLimit(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_RUNNING_LIMIT) fail('agents.maxRunning', `must be a whole number from 0 (no limit) to ${MAX_RUNNING_LIMIT}`);
  return value;
}

/** A number of minutes or more, or 0 for off. */
function offOrPositive(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path, 'must be a number, or 0 for off');
  return value;
}

/** A number of tokens: a whole number, 0 for off. */
function tokenCount(value) {
  if (!Number.isInteger(value) || value < 0) fail('agents.contextAlertTokens', 'must be a whole number of tokens, or 0 for off');
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

/** One provider's settings, filled from its defaults: { enabled, program, options: [word…] }. */
function provider(value, id) {
  const path = `providers.${id}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object');
  checkKeys(value, PROVIDER_KEYS, `${path}.`);
  const { enabled, program, options } = { ...DEFAULTS.providers[id], ...value };
  if (typeof enabled !== 'boolean') fail(`${path}.enabled`, 'must be true or false');
  if (typeof program !== 'string' || !PROGRAM.test(program)) {
    fail(`${path}.program`, 'must be a program name such as "claude", or a full path such as "~/.local/bin/claude", with no spaces or options');
  }
  if (typeof options !== 'string' || options.length > MAX_OPTIONS_LENGTH) fail(`${path}.options`, `must be text of up to ${MAX_OPTIONS_LENGTH} characters`);
  const words = options.trim().split(/[ \t]+/).filter(Boolean);
  if (/[\n\r]/.test(options) || words.some((word) => !OPTION_WORD.test(word))) {
    fail(`${path}.options`, 'must be plain words separated by spaces, such as "--model opus": no quotes, $, ;, | or other shell syntax');
  }
  return { enabled, program, options: words };
}

function providers(file) {
  const value = file.providers ?? {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('providers', 'must be an object');
  checkKeys(value, SECTION_KEYS.providers, 'providers.');
  const chosen = value.default ?? DEFAULTS.providers.default;
  const each = Object.fromEntries(PROVIDER_IDS.map((id) => [id, provider(value[id] ?? {}, id)]));
  if (!PROVIDER_IDS.includes(chosen)) fail('providers.default', `must be one of: ${PROVIDER_IDS.join(', ')}`);
  if (!each[chosen].enabled) fail('providers.default', `is ${chosen}, which is turned off; turn it on or choose another default`);
  return { default: chosen, ...each };
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
  const checks = section(file, 'checks');
  const checkMinutes = positiveNumber(checks.timeoutMinutes, 'checks.timeoutMinutes');
  if (checkMinutes > MAX_CHECK_MINUTES) fail('checks.timeoutMinutes', `must be at most ${MAX_CHECK_MINUTES}`);
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
      maxRunning: runningLimit(agents.maxRunning),
      stuckAfterMs: offOrPositive(agents.stuckAfterMinutes, 'agents.stuckAfterMinutes') * MINUTE_MS,
      contextAlertTokens: tokenCount(agents.contextAlertTokens),
    },
    tasks: {
      autoDeleteDone: tasks.autoDeleteDone,
      deleteDoneAfterMs: positiveNumber(tasks.deleteDoneAfterDays, 'tasks.deleteDoneAfterDays') * DAY_MS,
    },
    checks: { commands: checkCommands(checks.commands), timeoutMs: checkMinutes * MINUTE_MS },
    workers: workerSettings(section(file, 'workers')),
    providers: providers(file),
  };
}

/** Settings with no config file at all; used as defaults throughout. */
export const DEFAULT_SETTINGS = parseSettings({});
