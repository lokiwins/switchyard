import { createContext, use, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { placeholderFor, type Fields } from './form';

/*
 * The pieces a settings form is made of. Each field reads and writes its text
 * through the form (useSettingField), so the form holds every field's value
 * in one place and can tell what's changed.
 */

/* A setting: a label over its field, with what it does below. */
const SETTING = 'grid grid-cols-[minmax(0,1fr)] content-start gap-1 min-w-0 mb-4 last:mb-0';
const LABEL = 'text-sm font-semibold text-gray-900';

/** What a setting does, or what's in effect now: small and grey, breaking a long path anywhere. */
export const settingHintClass = 'text-xs text-gray-500 [overflow-wrap:anywhere]';

// A typed field: as wide as the panel up to 520px, ringed, the ring turning accent while you type in it.
const FIELD = [
  'w-full min-w-0 max-w-[520px] py-1.5 text-sm text-gray-900 bg-surface border-0 rounded-sm',
  'shadow-[inset_0_0_0_1px_var(--gray-200)] focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]',
].join(' ');
// The font's longhands, not `font: inherit`, which could undo text-sm.
const INHERIT_FONT = '[font-family:inherit] [font-weight:inherit] [line-height:inherit]';
/** A checkbox in a setting: its own size, beside its label, in the setting's text colour and face. */
export const settingCheckboxClass = `flex-none min-w-0 max-w-[520px] bg-surface text-gray-900 text-sm ${INHERIT_FONT}`;

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
    <label className={SETTING}>
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className={settingHintClass}>{hint}</span>}
      {after}
    </label>
  );
}

/** A setting typed as text: one line, or several (a list, one item per line). */
export function TextSetting({ name, label, hint, after, rows, inputMode, list, placeholder, children }: {
  name: string;
  /** Right after the box, e.g. the suggestions its `list` names. */
  children?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  /** More said under the hint, e.g. what's in effect now. */
  after?: ReactNode;
  /** Several lines, in the monospace face (a list, YAML). */
  rows?: number;
  inputMode?: 'decimal' | 'numeric';
  list?: string;
  placeholder?: string;
}) {
  const field = useSettingField(name);
  const shared = { name, value: field.value, placeholder: placeholder ?? field.placeholder, spellCheck: false };
  return (
    <Setting label={label} hint={hint} after={after}>
      {rows ? (
        <textarea {...shared} rows={rows} className={cx(FIELD, 'px-2.5 font-mono [font-weight:inherit] [line-height:inherit] resize-y')} onChange={(event) => field.set(event.target.value)} />
      ) : (
        <input {...shared} className={cx(FIELD, INHERIT_FONT, 'px-2.5')} inputMode={inputMode} list={list} autoComplete={inputMode ? undefined : 'off'}
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
      <select name={name} className={cx(FIELD, INHERIT_FONT, 'pl-2.5 pr-[30px]')} value={field.value} onChange={(event) => field.set(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Setting>
  );
}

/** A yes-or-no setting: its field is "true" or "false". */
export function ToggleSetting({ name, label, hint }: { name: string; label: ReactNode; hint?: ReactNode }) {
  const field = useSettingField(name);
  return (
    <label className={SETTING}>
      <span className={cx(LABEL, 'flex items-center gap-2 cursor-pointer')}>
        <input type="checkbox" className={cx(settingCheckboxClass, 'm-0')} name={name} checked={field.value === 'true'} onChange={(event) => field.set(String(event.target.checked))} />
        {' '}{label}
      </span>
      {hint && <span className={settingHintClass}>{hint}</span>}
    </label>
  );
}

/** Settings side by side, as many as fit at 200px or more. */
export const settingRowClass = 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 *:mb-0';

/** A group of settings asked as one question (a checklist), labelled by its legend. */
export function SettingGroup({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  return (
    <fieldset className={cx(SETTING, 'border-0 p-0 mx-0 min-w-0')}>
      <legend className={cx(LABEL, 'p-0 mb-1')}>{legend}</legend>
      {children}
    </fieldset>
  );
}
