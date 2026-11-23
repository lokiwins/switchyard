/** A search field's look without its width, for one that sizes itself (the graph's Find). */
export const searchInputBaseClass = [
  '[font-family:inherit] [line-height:inherit] text-sm px-2.5 py-1 max-w-full border-0 rounded-sm bg-surface-sunken text-gray-900',
  'shadow-[inset_0_0_0_1px_var(--divider)] placeholder:text-gray-400',
].join(' ');

/** A page's search field: a fixed width, and on a phone the whole row. */
export const searchInputClass = `${searchInputBaseClass} w-60 max-phone:w-full`;

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
