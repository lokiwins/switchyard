import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectSetting, SettingsFormProvider, settingRowClass, TextSetting, ToggleSetting } from './SettingsForm';

afterEach(cleanup);

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

function form(children: ReactNode) {
  return render(<SettingsFormProvider value={{ fields: { mode: 'a', roots: '', on: 'true', name: '' }, defaults: {}, set: () => {} }}>{children}</SettingsFormProvider>);
}

describe('settings fields', () => {
  it('a select leaves room for its arrow, setting only its background colour so the arrow stays', () => {
    form(<SelectSetting name="mode" label="Mode" options={[{ value: 'a', label: 'A' }]} />);
    const select = screen.getByRole('combobox');
    expect(classes(select)).toEqual(expect.arrayContaining(['pr-[30px]', 'bg-surface']));
    expect(classes(select).some((c) => /^\[background:/.test(c))).toBe(false);
  });

  it('a list is typed in the monospace face, and every field rings in the accent while typed in', () => {
    form(<><TextSetting name="roots" label="Folders" rows={3} /><TextSetting name="name" label="Name" /></>);
    expect(classes(screen.getByRole('textbox', { name: 'Folders' }))).toEqual(expect.arrayContaining(['font-mono', 'resize-y']));
    for (const box of screen.getAllByRole('textbox')) expect(classes(box).some((c) => c.startsWith('focus:shadow-'))).toBe(true);
  });

  it('a toggle is a checkbox beside its label, not a stretched field', () => {
    form(<ToggleSetting name="on" label="On" />);
    const box = screen.getByRole('checkbox', { name: 'On' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(classes(box)).not.toContain('w-full');
  });

  it('settings side by side drop the space under each', () => {
    expect(settingRowClass).toContain('*:mb-0');
  });

});
