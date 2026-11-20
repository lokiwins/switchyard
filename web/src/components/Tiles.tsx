import { cx } from '../lib/cx';

/* The counts at the top of a page; each is a filter, pressed again to show everything. */

export interface Tile<K extends string> { filter: K; label: string; value: number; tone?: string }

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
    <section className="tiles" id="tiles" aria-label="Summary">
      {tiles.map((tile) => (
        <button key={`${tile.filter}:${tile.label}`} type="button" className={cx('tile', tile.tone && `tone-${tile.tone}`, tile.value > 0 && 'has-value')}
          aria-pressed={current === tile.filter && tile.filter !== all}
          title={pressedHint && current === tile.filter ? pressedHint : undefined} onClick={() => onSelect(current === tile.filter ? all : tile.filter)}>
          <div className="value">{tile.value}</div>
          <div className="label">{tile.label}</div>
        </button>
      ))}
    </section>
  );
}
