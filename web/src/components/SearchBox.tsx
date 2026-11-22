/** A search field's look, for one that isn't a <SearchBox> (the graph's Find). On a phone it takes the row. */
export const searchInputClass = [
  '[font-family:inherit] [line-height:inherit] text-sm px-2.5 py-1 w-60 max-w-full border-0 rounded-sm bg-surface-sunken text-gray-900',
  'shadow-[inset_0_0_0_1px_var(--divider)] placeholder:text-gray-400 max-phone:w-full',
].join(' ');

/** A page's search box: it filters as you type (the page defers the lists, so typing stays quick). */
export function SearchBox({ placeholder, label, value, onChange }: {
  placeholder: string;
  label: string;
  value: string;
  onChange: (query: string) => void;
}) {
  return (
    <input id="search" type="search" className={searchInputClass} placeholder={placeholder} aria-label={label} defaultValue={value}
      onChange={(event) => onChange(event.target.value.trim())} />
  );
}
