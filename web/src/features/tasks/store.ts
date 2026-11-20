import { create } from 'zustand';

/*
 * The Tasks page's own state: the search, whether Done is open, and what
 * you've just asked of a task (starting, closing), shown at once while the
 * server does it.
 */

type Closing = 'done' | 'dropped' | 'delete';

interface TasksUi {
  query: string;
  doneOpen: boolean;
  creating: Record<string, true>;
  closing: Record<string, Closing>;
  setQuery: (query: string) => void;
  setDoneOpen: (open: boolean) => void;
  markCreating: (id: string, on: boolean) => void;
  markClosing: (id: string, kind: Closing | null) => void;
}

const without = <V>(record: Record<string, V>, id: string): Record<string, V> => {
  const { [id]: _gone, ...rest } = record;
  return rest;
};

export const useTasksUi = create<TasksUi>()((set) => ({
  query: '',
  doneOpen: false,
  creating: {},
  closing: {},
  setQuery: (query) => set({ query }),
  setDoneOpen: (doneOpen) => set({ doneOpen }),
  markCreating: (id, on) => set((s) => ({ creating: on ? { ...s.creating, [id]: true } : without(s.creating, id) })),
  markClosing: (id, kind) => set((s) => ({ closing: kind ? { ...s.closing, [id]: kind } : without(s.closing, id) })),
}));
