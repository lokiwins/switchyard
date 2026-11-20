import { appearanceApi, useAppearance, type AppearanceKey } from '../lib/appearance';
import { MODES, TERMINAL_CHOICES, THEMES, type Choice } from '../lib/themes';
import { Menu } from './Menu';

/* ◐ in the top bar: this browser's theme, light or dark, and terminal colours, or the Settings defaults. */

const GROUPS: { key: AppearanceKey; label: string; list: readonly Choice[] }[] = [
  { key: 'theme', label: 'Theme', list: THEMES },
  { key: 'mode', label: 'Light or dark', list: MODES },
  { key: 'terminal', label: 'Terminal', list: TERMINAL_CHOICES },
];

const labelOf = (list: readonly Choice[], id: string | undefined) => list.find((c) => c.id === id)?.label ?? id ?? '';

function ChoiceItem({ chosen, label, onChoose }: { chosen: boolean; label: string; onChoose: () => void }) {
  return (
    <button type="button" className="menu-item theme-choice" role="menuitemradio" aria-checked={chosen} onClick={onChoose}>
      <span className="theme-tick" aria-hidden="true">{chosen ? '✓' : ''}</span>
      <span className="menu-title">{label}</span>
    </button>
  );
}

export function ThemeMenu() {
  const now = useAppearance();
  const api = appearanceApi();
  if (!now || !api) return null;
  return (
    <Menu
      label={<><span aria-hidden="true">◐</span><span className="visually-hidden">Theme</span></>}
      title="Theme, light or dark, and terminal colours for this browser"
      className="btn btn-sm btn-secondary theme-button"
      panelClass="theme-panel"
      focusInput={false}
    >
      <div className="theme-choices">
        {GROUPS.map(({ key, label, list }) => (
          <div key={key} className={`theme-group is-${key}`} role="group" aria-label={label}>
            <div className="menu-label">{label}</div>
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
