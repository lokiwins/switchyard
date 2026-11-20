import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { readPref, writePref } from '../../lib/prefs';
import { isFilterKey, type FilterKey } from './filters';

/* The Agents page's own state: what it shows, not what the server says (that's in the query cache). */

const FILTER_PREF = 'switchyard.agentFilter';

interface AgentsUi {
  filter: FilterKey;
  query: string;
  showParked: boolean;
  showAllEnded: boolean;
  openDetails: Record<string, true>;
  setFilter: (filter: FilterKey) => void;
  setQuery: (query: string) => void;
  toggleParked: () => void;
  toggleAllEnded: () => void;
  toggleDetail: (sessionId: string) => void;
}

// The filter is kept as it always was in this browser: the bare key under switchyard.agentFilter.
const filterStorage: StateStorage = {
  getItem: () => {
    const saved = readPref(FILTER_PREF);
    return isFilterKey(saved) ? JSON.stringify({ state: { filter: saved }, version: 0 }) : null;
  },
  setItem: (_name, value) => writePref(FILTER_PREF, (JSON.parse(value) as { state: { filter: string } }).state.filter),
  removeItem: () => writePref(FILTER_PREF, ''),
};

export const useAgentsUi = create<AgentsUi>()(persist((set) => ({
  filter: 'all',
  query: '',
  showParked: false,
  showAllEnded: false,
  openDetails: {},
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  toggleParked: () => set((s) => ({ showParked: !s.showParked })),
  toggleAllEnded: () => set((s) => ({ showAllEnded: !s.showAllEnded })),
  toggleDetail: (id) => set((s) => {
    const { [id]: open, ...rest } = s.openDetails;
    return { openDetails: open ? rest : { ...rest, [id]: true } };
  }),
}), {
  name: FILTER_PREF,
  storage: createJSONStorage(() => filterStorage),
  partialize: (s) => ({ filter: s.filter }),
}));
