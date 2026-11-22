import { cx } from '../lib/cx';

/*
 * The counts at the top of a page; each is a filter, pressed again to show
 * everything. A tile's tone is a stripe down its left edge, and its number's
 * colour once there's something to count. A theme can size the numbers
 * (--tile-value-size; see themes.css).
 */

export interface Tile<K extends string> { filter: K; label: string; value: number; tone?: string }

const TONES: Record<string, string> = {
  green: '[--tone:var(--green)]',
  amber: '[--tone:var(--amber)]',
  red: '[--tone:var(--red)]',
  purple: '[--tone:var(--purple)]',
};

// The font's longhands, not `font: inherit`: the shorthand, a utility like the rest, could undo the sizes the others set.
const TILE = [
  'relative overflow-hidden flex items-baseline gap-2 py-2.5 pr-3 pl-4 text-left [font-family:inherit] [font-size:inherit] [font-weight:inherit] [line-height:inherit] [color:inherit]',
  'bg-surface border-0 rounded-sm cursor-pointer shadow-[inset_0_0_0_1px_var(--hairline)]',
  'transition-shadow duration-150 ease-[ease] motion-reduce:transition-none',
  'hover:shadow-[inset_0_0_0_1px_var(--gray-200),var(--shadow-md)] aria-pressed:shadow-[inset_0_0_0_2px_var(--accent)]',
  "before:content-[''] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-[2px] before:bg-(--tone,transparent)",
].join(' ');

const VALUE = [
  '[font-family:var(--font-display)] [font-weight:var(--font-weight-display)] leading-[28px] tabular-nums',
  'text-[length:var(--tile-value-size,var(--text-2xl))]',
].join(' ');

export function Tiles<K extends string>({ tiles, current, onSelect, all, pressedHint }: {
  tiles: Tile<K>[];
  current: K;
  onSelect: (filter: K) => void;
  /** The filter that shows everything: a tile for it never reads as pressed. */
  all: K;
  /** What a pressed tile says it does now, if the page says. */
  pressedHint?: string;
}) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2" id="tiles" aria-label="Summary">
      {tiles.map((tile) => (
        <button key={`${tile.filter}:${tile.label}`} type="button" className={cx(TILE, tile.tone && TONES[tile.tone])}
          aria-pressed={current === tile.filter && tile.filter !== all}
          title={pressedHint && current === tile.filter ? pressedHint : undefined} onClick={() => onSelect(current === tile.filter ? all : tile.filter)}>
          <div className={cx(VALUE, tile.value > 0 ? 'text-(--tone,var(--gray-900))' : 'text-gray-400')}>{tile.value}</div>
          <div className="text-gray-500 text-xs leading-xs font-medium">{tile.label}</div>
        </button>
      ))}
    </section>
  );
}
