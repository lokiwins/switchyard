import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { bareFieldStorage } from '../../lib/pref-storage';
import { isPrFilter, type PrFilter } from './filters';

/* The PRs page's own state: which PRs it shows. */

const FILTER_PREF = 'switchyard.prFilter';

interface PrsUi {
  filter: PrFilter;
  query: string;
  setFilter: (filter: PrFilter) => void;
  setQuery: (query: string) => void;
}

export const usePrsUi = create<PrsUi>()(persist((set) => ({
  filter: 'all',
  query: '',
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
}), {
  name: FILTER_PREF,
  storage: createJSONStorage(() => bareFieldStorage(FILTER_PREF, 'filter', isPrFilter)),
  partialize: (s) => ({ filter: s.filter }),
}));
