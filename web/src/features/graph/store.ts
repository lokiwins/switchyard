import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { prefFieldsStorage, stringListField } from '../../lib/pref-storage';

/* The graph page's own state: which kinds of node are hidden (kept as before), and which node is selected. */

interface GraphUi {
  hidden: string[];
  selected: string | null;
  setShown: (kind: string, shown: boolean) => void;
  select: (id: string | null) => void;
}

export const useGraphUi = create<GraphUi>()(persist((set) => ({
  hidden: [],
  selected: null,
  setShown: (kind, shown) => set((s) => ({ hidden: shown ? s.hidden.filter((k) => k !== kind) : [...new Set([...s.hidden, kind])] })),
  select: (selected) => set({ selected }),
}), {
  name: 'graph.hiddenKinds',
  storage: createJSONStorage(() => prefFieldsStorage({ hidden: stringListField('graph.hiddenKinds') })),
  partialize: (s) => ({ hidden: s.hidden }),
}));
