/*
 * The Settings form's fields, by name ("section.key", or "roots"), to and
 * from the settings the server sends and takes.
 */

const LISTS = new Set(['roots', 'git.longLivedBranches', 'ci.holdPatterns', 'ci.stripPrefixes']);
const NUMBERS = new Set(['agents.parkedAfterHours', 'agents.endedHistoryDays', 'agents.interruptedAttentionDays']);
// A prefix's trailing space is part of what's removed from a check's name.
const UNTRIMMED = new Set(['ci.stripPrefixes']);

/** Every field the form has, by name. */
export const FIELD_NAMES = [
  'roots', 'terminal.app', 'editor.urlScheme',
  'agents.parkedAfterHours', 'agents.endedHistoryDays', 'agents.interruptedAttentionDays',
  'github.copilotReviewer', 'git.longLivedBranches', 'ci.holdPatterns', 'ci.stripPrefixes',
];

const valueAt = (values, name) => name.split('.').reduce((value, key) => value?.[key], values);

/** The settings as the text each field shows: a list one item per line. */
export function fieldsFromValues(values) {
  return Object.fromEntries(FIELD_NAMES.map((name) => {
    const value = valueAt(values, name);
    return [name, Array.isArray(value) ? value.join('\n') : String(value ?? '')];
  }));
}

function readField(name, text) {
  if (LISTS.has(name)) {
    return text.split('\n').map((line) => (UNTRIMMED.has(name) ? line : line.trim())).filter((line) => line.trim() !== '');
  }
  if (NUMBERS.has(name)) {
    const number = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(number) ? number : text;
  }
  return text.trim();
}

/** The form's fields as the settings to save. */
export function editsFromFields(fields) {
  const edits = {};
  for (const name of FIELD_NAMES) {
    const value = readField(name, fields[name] ?? '');
    const [section, key] = name.split('.');
    if (!key) edits[section] = value;
    else edits[section] = { ...edits[section], [key]: value };
  }
  return edits;
}
