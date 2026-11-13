import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { ActionError } from './errors.js';
import { expandHome } from './config.js';
import { DEFAULTS, SettingsError, parseSettings } from './settings.js';

/*
 * config.json, as the Settings page reads and edits it. The page edits the
 * sections below and the roots; port and claudeDir are left as they are,
 * since they only take effect when switchyard starts.
 */

/** The settings the page edits, by section; each key's default comes from DEFAULTS. */
export const EDITABLE = {
  terminal: ['app'],
  editor: ['urlScheme'],
  agents: ['parkedAfterHours', 'endedHistoryDays', 'interruptedAttentionDays'],
  github: ['copilotReviewer', 'issueRepos'],
  git: ['longLivedBranches'],
  ci: ['holdPatterns', 'stripPrefixes'],
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (message) => new ActionError(400, message);

/** What the page shows: config.json's values, with the default for each one it leaves out. */
export function editableSettings(file) {
  const sections = Object.fromEntries(Object.entries(EDITABLE).map(([name, keys]) => [
    name,
    Object.fromEntries(keys.map((key) => [key, file[name]?.[key] ?? DEFAULTS[name][key]])),
  ]));
  return { roots: Array.isArray(file.roots) ? [...file.roots] : [], ...sections };
}

function cleanRoots(roots) {
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) throw invalid('"roots" must be a list of folders');
  const kept = roots.map((root) => root.trim()).filter(Boolean);
  const missing = kept.filter((root) => !existsSync(expandHome(root)));
  if (missing.length > 0) throw invalid(`No such folder: ${missing.join(', ')}`);
  return kept;
}

function editSection(current, name, edits) {
  if (!isObject(edits)) throw invalid(`"${name}" must be an object`);
  const next = { ...(isObject(current) ? current : {}) };
  for (const [key, value] of Object.entries(edits)) {
    if (!EDITABLE[name].includes(key)) throw invalid(`"${name}.${key}" is not a setting the page can change`);
    if (same(value, DEFAULTS[name][key])) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * config.json with `edits` made: a value equal to its default is left out,
 * so a later default still reaches you. Refused (400) when switchyard
 * wouldn't start with the result.
 */
export function applyEdits(file, edits) {
  if (!isObject(edits)) throw invalid('Expected the settings as an object');
  const next = { ...file };
  for (const [name, value] of Object.entries(edits)) {
    if (name === 'roots') {
      const roots = cleanRoots(value);
      if (roots.length > 0) next.roots = roots;
      else delete next.roots;
    } else if (Object.hasOwn(EDITABLE, name)) {
      const section = editSection(next[name], name, value);
      if (Object.keys(section).length > 0) next[name] = section;
      else delete next[name];
    } else {
      throw invalid(`"${name}" is not a setting the page can change`);
    }
  }
  try {
    parseSettings(next);
  } catch (error) {
    if (error instanceof SettingsError) throw invalid(error.message.replace(/^config\.json: /, ''));
    throw error;
  }
  return next;
}

/** config.json at `path`: read it, and save edits to it (written whole, then moved into place). */
export function createSettingsStore({ path }) {
  function read() {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new ActionError(500, `Could not read ${path}: ${error.message}`);
    }
  }

  return {
    path,
    read,

    /** Save `edits`; resolves to the file as saved and the settings it gives. */
    save(edits) {
      const file = applyEdits(read(), edits);
      const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o644;
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode });
      chmodSync(temporary, mode);
      renameSync(temporary, path);
      return { file, settings: parseSettings(file) };
    },
  };
}

/**
 * The Settings page's data, and saving it: a save goes to config.json, then
 * to the live config, and answers once `onSaved` has caught up whatever
 * depends on the settings (cached views, the repo list).
 */
export function createSettingsService({ store, live, onSaved = async () => {} }) {
  function view() {
    return {
      values: editableSettings(store.read()),
      defaults: editableSettings({}),
      configPath: store.path,
      port: live.port,
      claudeDir: live.claudeDir,
      roots: live.roots,
      rootsFromEnv: live.rootsFromEnv,
    };
  }
  return {
    view,
    async save(edits) {
      const { file } = store.save(edits);
      live.update(file);
      await onSaved();
      return view();
    },
  };
}
