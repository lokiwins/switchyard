import { create } from 'zustand';
import type { PendingTask } from '../lib/pending-tasks';

/* Tasks started from New task whose session hasn't shown up yet; the Agents page shows them as rows meanwhile. */

interface PendingState {
  tasks: PendingTask[];
  add: (task: PendingTask) => void;
  update: (id: string, change: (task: PendingTask) => PendingTask) => void;
  remove: (id: string) => void;
  replace: (tasks: PendingTask[]) => void;
}

export const usePendingStore = create<PendingState>()((set) => ({
  tasks: [],
  add: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  update: (id, change) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? change(t) : t)) })),
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  replace: (tasks) => set({ tasks }),
}));
