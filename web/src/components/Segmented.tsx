/*
 * A row of choices, one picked (Show: All · Working · Waiting …). A filter
 * picked elsewhere that has no segment here (a tile's) shows as a chip you
 * can clear, so every filter can be seen and undone.
 */
export function Segmented<K extends string>({ choices, value, onChange, label, extra }: {
  choices: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  extra?: { label: string; onClear: () => void } | null;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id="views">
      {extra && (
        <button type="button" className="filter-chip" title="Clear this filter" aria-label={`Clear filter: ${extra.label}`} onClick={extra.onClear}>
          {extra.label}<span aria-hidden="true">✕</span>
        </button>
      )}
      {choices.map((choice) => (
        <button key={choice.key} type="button" role="radio" aria-checked={value === choice.key} onClick={() => onChange(choice.key)}>{choice.label}</button>
      ))}
    </div>
  );
}
