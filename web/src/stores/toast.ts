import { create } from 'zustand';

/* The short message at the bottom of the page; one at a time, the newest wins. */

export interface ToastAction { label: string; run: () => void }
interface Toast { id: number; message: string; action: ToastAction | null }

// A toast you can act on (Undo) stays long enough to reach it.
const ACTION_TOAST_MS = 8000;
const LONG_TOAST_MS = 5000;
const SHORT_TOAST_MS = 1600;
const LONG_MESSAGE_CHARS = 60;

interface ToastState {
  toast: Toast | null;
  show: (message: string, action?: ToastAction | null) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  toast: null,
  show: (message, action = null) => set({ toast: { id: nextId++, message, action } }),
  dismiss: (id) => set((state) => (state.toast?.id === id ? { toast: null } : state)),
}));

export const toastDuration = ({ message, action }: Toast): number => {
  if (action) return ACTION_TOAST_MS;
  return message.length > LONG_MESSAGE_CHARS ? LONG_TOAST_MS : SHORT_TOAST_MS;
};

/** Show a toast from anywhere: an event handler, a mutation's callback. */
export const toast = (message: string, action: ToastAction | null = null): void => useToastStore.getState().show(message, action);
