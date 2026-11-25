/*
 * The Settings form's fields by name ("section.key", "providers.<id>.key", or
 * "roots"), each as the text it shows, to and from the settings the server
 * sends and takes.
 */

export type Fields = Record<string, string>;
export type SettingsValues = Record<string, unknown>;

const LISTS = new Set(['roots', 'github.issueRepos', 'git.longLivedBranches', 'ci.holdPatterns', 'ci.stripPrefixes', 'workers.allowedTools']);
const NUMBERS = new Set(['agents.parkedAfterHours', 'agents.endedHistoryDays', 'agents.interruptedAttentionDays', 'agents.maxRunning', 'agents.stuckAfterMinutes', 'agents.contextAlertTokens', 'tasks.deleteDoneAfterDays', 'checks.timeoutMinutes']);
// Checkboxes: "true" or "false" in the form.
const BOOLEANS = new Set(['tasks.autoDeleteDone', 'providers.claude.enabled']);
// A prefix's trailing space is part of what's removed from a check's name.
const UNTRIMMED = new Set(['ci.stripPrefixes']);

/** Every field the form has, by name. */
export const FIELD_NAMES: readonly string[] = [
  'roots', 'appearance.theme', 'appearance.mode', 'appearance.terminal', 'terminal.app', 'editor.urlScheme',
  'agents.parkedAfterHours', 'agents.endedHistoryDays', 'agents.interruptedAttentionDays', 'agents.maxRunning',
  'agents.stuckAfterMinutes', 'agents.contextAlertTokens',
  'github.copilotReviewer', 'github.issueRepos', 'git.longLivedBranches', 'ci.holdPatterns', 'ci.stripPrefixes',
  'tasks.autoDeleteDone', 'tasks.deleteDoneAfterDays', 'checks.commands', 'checks.timeoutMinutes',
  'workers.permissionMode', 'workers.allowedTools', 'prReview.instructions',
  'providers.default', 'providers.claude.enabled', 'providers.claude.program', 'providers.claude.options',
];

const valueAt = (values: SettingsValues, name: string): unknown =>
  name.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as SettingsValues)[key] : undefined), values);

/** The settings as the text each field shows: a list one item per line. */
export function fieldsFromValues(values: SettingsValues): Fields {
  return Object.fromEntries(FIELD_NAMES.map((name) => {
    const value = valueAt(values, name);
    return [name, Array.isArray(value) ? value.join('\n') : String(value ?? '')];
  }));
}

function readField(name: string, text: string): unknown {
  if (LISTS.has(name)) {
    return text.split('\n').map((line) => (UNTRIMMED.has(name) ? line : line.trim())).filter((line) => line.trim() !== '');
  }
  if (BOOLEANS.has(name)) return text === 'true';
  if (NUMBERS.has(name)) {
    const number = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(number) ? number : text;
  }
  return text.trim();
}

/** The form's fields as the settings to save. */
export function editsFromFields(fields: Fields): SettingsValues {
  const edits: SettingsValues = {};
  for (const name of FIELD_NAMES) {
    const value = readField(name, fields[name] ?? '');
    const [section = name, key, inner] = name.split('.');
    const current = (edits[section] ?? {}) as SettingsValues;
    if (!key) edits[section] = value;
    else if (!inner) edits[section] = { ...current, [key]: value };
    else edits[section] = { ...current, [key]: { ...(current[key] as SettingsValues | undefined), [inner]: value } };
  }
  return edits;
}

/** Whether any field reads differently from what's saved. */
export const hasChanges = (fields: Fields, saved: Fields): boolean => FIELD_NAMES.some((name) => fields[name] !== saved[name]);

/** What a field shows when empty: the default's first line; folders get an example instead. */
export const placeholderFor = (name: string, defaults: Fields): string => (name === 'roots' ? '~/work' : (defaults[name] ?? '').split('\n')[0] ?? '');

export interface SettingsView {
  values: SettingsValues;
  defaults: SettingsValues;
  roots: string[];
  rootsFromEnv: boolean;
  port: number;
  claudeDir: string;
  configPath: string;
}
