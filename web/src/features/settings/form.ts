import { editsFromFields as toEdits, FIELD_NAMES as names, fieldsFromValues as toFields } from '../../../../public/settings-form.js';

/*
 * The form's fields by name ("section.key", "providers.<id>.key", or "roots"),
 * each as the text it shows; to and from settings in public/settings-form.js,
 * which is tested in node and checked against the server's settings.
 */

export type Fields = Record<string, string>;
export type SettingsValues = Record<string, unknown>;

export const FIELD_NAMES = names as readonly string[];
export const fieldsFromValues = toFields as (values: SettingsValues) => Fields;
export const editsFromFields = toEdits as (fields: Fields) => SettingsValues;

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
