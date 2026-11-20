import { cx } from '../../lib/cx';
import type { AgentsData } from '../../lib/types';
import { tiles } from './filters';
import { useAgentsUi } from './store';

/** The counts at the top; each one is a filter, pressed again to show everything. */
export function Tiles({ data }: { data: AgentsData }) {
  const filter = useAgentsUi((s) => s.filter);
  const setFilter = useAgentsUi((s) => s.setFilter);
  return (
    <section className="tiles" id="tiles" aria-label="Summary">
      {tiles(data).map((tile) => (
        <button key={tile.filter} type="button" className={cx('tile', tile.tone && `tone-${tile.tone}`, tile.value > 0 && 'has-value')}
          aria-pressed={filter === tile.filter} onClick={() => setFilter(filter === tile.filter ? 'all' : tile.filter)}>
          <div className="value">{tile.value}</div>
          <div className="label">{tile.label}</div>
        </button>
      ))}
    </section>
  );
}
