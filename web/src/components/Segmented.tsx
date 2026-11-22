/*
 * A row of choices, one picked (Show: All · Working · Waiting …). A filter
 * picked elsewhere that has no segment here (a tile's) shows as a chip you
 * can clear, so every filter can be seen and undone. On a phone the choices
 * wrap rather than widen the page.
 */

const CHOICE = [
  '[font-family:inherit] [line-height:inherit] text-xs font-medium px-2.5 py-0.75 border-0 rounded-xs bg-transparent text-gray-500 cursor-pointer hover:text-gray-900',
  'aria-checked:bg-surface aria-checked:text-gray-900 aria-checked:shadow-[var(--shadow-sm),inset_0_0_0_1px_var(--hairline)]',
].join(' ');

const CHIP = [
  'group inline-flex items-center gap-1.5 [font-family:inherit] [line-height:inherit] text-xs font-semibold py-0.75 pr-1.5 pl-2.5',
  'border-0 rounded-xs cursor-pointer bg-accent text-on-accent',
].join(' ');

export function Segmented<K extends string>({ choices, value, onChange, label, extra }: {
  choices: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  extra?: { label: string; onClear: () => void } | null;
}) {
  return (
    <div
      className="inline-flex gap-0.5 p-0.5 bg-surface-sunken rounded-sm shadow-[inset_0_0_0_1px_var(--divider)] max-phone:flex max-phone:flex-wrap"
      role="radiogroup" aria-label={label} id="views"
    >
      {extra && (
        <button type="button" className={CHIP} title="Clear this filter" aria-label={`Clear filter: ${extra.label}`} onClick={extra.onClear}>
          {extra.label}<span className="opacity-80 group-hover:opacity-100" aria-hidden="true">✕</span>
        </button>
      )}
      {choices.map((choice) => (
        <button key={choice.key} type="button" className={CHOICE} role="radio" aria-checked={value === choice.key} onClick={() => onChange(choice.key)}>{choice.label}</button>
      ))}
    </div>
  );
}
