import { createContext, use, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { placeholderFor, type Fields } from './form';

/*
 * The pieces a settings form is made of. Each field reads and writes its text
 * through the form (useSettingField), so the form holds every field's value
 * in one place and can tell what's changed.
 */

interface FormState { fields: Fields; defaults: Fields; set: (name: string, value: string) => void }

const FormContext = createContext<FormState | null>(null);

export function SettingsFormProvider({ value, children }: { value: FormState; children: ReactNode }) {
  return <FormContext value={value}>{children}</FormContext>;
}

/** One field's text, what it shows when empty, and how to change it. */
export function useSettingField(name: string) {
  const form = use(FormContext);
  if (!form) throw new Error('useSettingField is used outside a settings form');
  return {
    name,
    value: form.fields[name] ?? '',
    placeholder: placeholderFor(name, form.defaults),
    set: (value: string) => form.set(name, value),
  };
}

/** A setting: its label, its control, and what it does. */
export function Setting({ label, hint, after, children }: { label: ReactNode; hint?: ReactNode; after?: ReactNode; children?: ReactNode }) {
  return (
    <label className="setting">
      <span className="setting-label">{label}</span>
      {children}
      {hint && <span className="setting-hint">{hint}</span>}
      {after}
    </label>
  );
}

/** A setting typed as text: one line, or several (a list, one item per line). */
export function TextSetting({ name, label, hint, after, rows, mono, inputMode, list, placeholder, children }: {
  name: string;
  /** Right after the box, e.g. the suggestions its `list` names. */
  children?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  /** More said under the hint, e.g. what's in effect now. */
  after?: ReactNode;
  rows?: number;
  mono?: boolean;
  inputMode?: 'decimal' | 'numeric';
  list?: string;
  placeholder?: string;
}) {
  const field = useSettingField(name);
  const shared = { name, value: field.value, placeholder: placeholder ?? field.placeholder, spellCheck: false };
  return (
    <Setting label={label} hint={hint} after={after}>
      {rows ? (
        <textarea {...shared} rows={rows} className={cx(mono && 'mono') || undefined} onChange={(event) => field.set(event.target.value)} />
      ) : (
        <input {...shared} inputMode={inputMode} list={list} autoComplete={inputMode ? undefined : 'off'}
          spellCheck={inputMode ? undefined : false} onChange={(event) => field.set(event.target.value)} />
      )}
      {children}
    </Setting>
  );
}

export function SelectSetting({ name, label, hint, options }: { name: string; label: ReactNode; hint?: ReactNode; options: { value: string; label: string }[] }) {
  const field = useSettingField(name);
  return (
    <Setting label={label} hint={hint}>
      <select name={name} value={field.value} onChange={(event) => field.set(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Setting>
  );
}

/** A yes-or-no setting: its field is "true" or "false". */
export function ToggleSetting({ name, label, hint }: { name: string; label: ReactNode; hint?: ReactNode }) {
  const field = useSettingField(name);
  return (
    <label className="setting">
      <span className="setting-label setting-toggle">
        <input type="checkbox" name={name} checked={field.value === 'true'} onChange={(event) => field.set(String(event.target.checked))} />
        {' '}{label}
      </span>
      {hint && <span className="setting-hint">{hint}</span>}
    </label>
  );
}
