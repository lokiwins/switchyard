import { create } from 'zustand';
import type { Approval, LiveSession } from '../lib/types';

/*
 * The glass pane that's open, if any: a permission prompt to review, a plan,
 * a task form, a live terminal. Held apart from the rows that open them, so a
 * pane stays open when its row changes or goes.
 */

export type MakeTaskFrom = { sessionId: string } | { worktree: string };

export type Pane =
  | { kind: 'review'; approval: Approval; session: LiveSession }
  | { kind: 'plan'; sessionId: string }
  | { kind: 'make-task'; from: MakeTaskFrom }
  | { kind: 'terminal'; session: LiveSession };

interface PaneState {
  pane: Pane | null;
  open: (pane: Pane) => void;
  close: () => void;
}

export const usePaneStore = create<PaneState>()((set) => ({
  pane: null,
  open: (pane) => set({ pane }),
  close: () => set({ pane: null }),
}));

export const openPane = (pane: Pane): void => usePaneStore.getState().open(pane);
