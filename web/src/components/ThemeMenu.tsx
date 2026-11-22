import { appearanceApi, useAppearance, type AppearanceKey } from '../lib/appearance';
import { MODES, TERMINAL_CHOICES, THEMES, type Choice } from '../lib/themes';
import { Menu, MenuItem, MenuLabel, MenuTitle } from './Menu';

/* ◐ in the top bar: this browser's theme, light or dark, and terminal colours, or the Settings defaults. */

const GROUPS: { key: AppearanceKey; label: string; list: readonly Choice[] }[] = [
  { key: 'theme', label: 'Theme', list: THEMES },
  { key: 'mode', label: 'Light or dark', list: MODES },
  { key: 'terminal', label: 'Terminal', list: TERMINAL_CHOICES },
];

// Terminal schemes sit two to a row, under the heading and the Settings default, which take a row each.
const GROUP_LAYOUT: Record<AppearanceKey, string> = {
  theme: 'flex flex-col',
  mode: 'flex flex-col',
  terminal: 'grid grid-cols-2 [&>:nth-child(-n+2)]:col-span-full',
};

const labelOf = (list: readonly Choice[], id: string | undefined) => list.find((c) => c.id === id)?.label ?? id ?? '';

function ChoiceItem({ chosen, label, onChoose }: { chosen: boolean; label: string; onChoose: () => void }) {
  return (
    <MenuItem role="menuitemradio" aria-checked={chosen} onClick={onChoose}>
      <span className="flex-none w-[1em] text-accent" aria-hidden="true">{chosen ? '✓' : ''}</span>
      <MenuTitle>{label}</MenuTitle>
    </MenuItem>
  );
}

export function ThemeMenu() {
  const now = useAppearance();
  const api = appearanceApi();
  if (!now || !api) return null;
  return (
    <Menu
      label={<><span aria-hidden="true">◐</span><span className="sr-only">Theme</span></>}
      title="Theme, light or dark, and terminal colours for this browser"
      look={{ variant: 'secondary', size: 'glyph' }}
      // A short window scrolls the panel rather than the page.
      width={[300, 340]}
      panelClass="max-h-[calc(100vh-72px)] overflow-y-auto overscroll-contain"
      focusInput={false}
    >
      <div className="flex flex-col">
        {GROUPS.map(({ key, label, list }, index) => (
          <div key={key} className={GROUP_LAYOUT[key]} role="group" aria-label={label}>
            <MenuLabel divided={index > 0}>{label}</MenuLabel>
            <ChoiceItem
              chosen={!now.own[key]}
              label={`Settings default (${labelOf(list, now.defaults[key])})`}
              onChoose={() => api.choose({ [key]: null })}
            />
            {list.map((item) => (
              <ChoiceItem key={item.id} chosen={now.own[key] === item.id} label={item.label} onChoose={() => api.choose({ [key]: item.id })} />
            ))}
          </div>
        ))}
      </div>
    </Menu>
  );
}
