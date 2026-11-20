import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { announceChange } from '../lib/changes';
import { toast } from '../stores/toast';
import { buttonClass, type ButtonLook } from './Button';

/**
 * A button that runs a server action: disabled while it runs, its outcome
 * toasted (`perform` resolves the message, or nothing), and the page's data
 * looked at again after.
 */
export function ActionButton({
  label, title, look = { variant: 'action' }, perform, onDone,
}: {
  label: ReactNode;
  title?: string;
  look?: ButtonLook;
  perform: () => Promise<string | null | void>;
  onDone?: () => void;
}) {
  const action = useMutation({
    mutationFn: perform,
    onSuccess: (message) => {
      if (message) toast(message);
      onDone?.();
    },
    onError: (error) => toast(error.message),
    onSettled: () => announceChange(),
  });
  return (
    <button type="button" className={buttonClass(look)} title={title} disabled={action.isPending} onClick={() => action.mutate()}>
      {label}
    </button>
  );
}
