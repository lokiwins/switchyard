import { Tiles } from '../../components/Tiles';
import type { AgentsData } from '../../lib/types';
import { tiles } from './filters';
import { useAgentsUi } from './store';

export function AgentTiles({ data }: { data: AgentsData }) {
  const filter = useAgentsUi((s) => s.filter);
  const setFilter = useAgentsUi((s) => s.setFilter);
  return <Tiles tiles={tiles(data)} current={filter} onSelect={setFilter} all="all" />;
}
