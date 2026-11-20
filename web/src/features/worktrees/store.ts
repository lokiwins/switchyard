import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { bareField, prefFieldsStorage, stringListField } from '../../lib/pref-storage';
import { isView, type View } from './views';

/* The Worktrees page's own state: the view, the search, and which repos are folded (both kept as they always were). */

interface WorktreesUi {
  view: View;
  query: string;
  collapsed: string[];
  setView: (view: View) => void;
  setQuery: (query: string) => void;
  setCollapsed: (mainPath: string, collapsed: boolean) => void;
}

export const useWorktreesUi = create<WorktreesUi>()(persist((set) => ({
  view: 'active',
  query: '',
  collapsed: [],
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  setCollapsed: (mainPath, collapsed) => set((s) => ({
    collapsed: collapsed ? [...new Set([...s.collapsed, mainPath])] : s.collapsed.filter((p) => p !== mainPath),
  })),
}), {
  name: 'switchyard.view',
  storage: createJSONStorage(() => prefFieldsStorage({ view: bareField('switchyard.view', isView), collapsed: stringListField('switchyard.collapsed') })),
  partialize: (s) => ({ view: s.view, collapsed: s.collapsed }),
}));
