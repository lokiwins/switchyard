import { create } from 'zustand';

/*
 * What you've typed in a reply or answer box, by box. Kept apart from the box,
 * so it's still there when the box comes back (a session that asked something
 * and went back to work shows Reply again), until it's sent.
 */

interface DraftState {
  drafts: Record<string, string>;
  set: (key: string, text: string) => void;
}

export const useDraftStore = create<DraftState>()((set) => ({
  drafts: {},
  set: (key, text) => set((s) => {
    const { [key]: _old, ...rest } = s.drafts;
    return { drafts: text ? { ...rest, [key]: text } : rest };
  }),
}));

/** A box's draft and its setter, like useState. */
export function useDraft(key: string): [string, (text: string) => void] {
  const text = useDraftStore((s) => s.drafts[key] ?? '');
  const set = useDraftStore((s) => s.set);
  return [text, (next) => set(key, next)];
}
