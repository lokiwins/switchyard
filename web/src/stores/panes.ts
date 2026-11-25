import { create } from 'zustand';
import type { Approval, LiveSession } from '../lib/types';

/*
 * The glass pane that's open, if any: a permission prompt to review, a plan,
 * a task form, a live terminal. Held apart from the rows that open them, so a
 * pane stays open when its row changes or goes.
 */

export type MakeTaskFrom = { sessionId: string } | { worktree: string };

/** A task's details as the task pane edits them; a task not made yet has no id. */
export interface TaskDraft { id: string | null; title: string; notes: string; dueOn: string | null; links: string[]; state?: string }
export interface TaskPaneFields { title: string; dueOn: string | null; notes: string; links: string[] }

export type Pane =
  | { kind: 'review'; approval: Approval; session: LiveSession }
  | {
    kind: 'task';
    task: TaskDraft;
    /** For a task not made yet: its heading, the line under it, and its button. */
    heading?: string;
    sub?: string | null;
    submitLabel?: string;
    /** Resolves whether it saved; the pane closes when it did. */
    save: (fields: TaskPaneFields) => Promise<boolean>;
  }
  | { kind: 'plan'; sessionId: string }
  | { kind: 'make-task'; from: MakeTaskFrom }
  | { kind: 'terminal'; session: LiveSession }
  | { kind: 'report'; heading: string; sub?: string; markdown: string };

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
