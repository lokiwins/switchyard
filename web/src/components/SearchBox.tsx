/** A page's search box: it filters as you type (the page defers the lists, so typing stays quick). */
export function SearchBox({ placeholder, label, value, onChange }: {
  placeholder: string;
  label: string;
  value: string;
  onChange: (query: string) => void;
}) {
  return (
    <input id="search" type="search" placeholder={placeholder} aria-label={label} defaultValue={value}
      onChange={(event) => onChange(event.target.value.trim())} />
  );
}
