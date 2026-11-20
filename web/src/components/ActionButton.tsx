import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { announceChange } from '../lib/changes';
import { toast } from '../stores/toast';

/**
 * A button that runs a server action: disabled while it runs, its outcome
 * toasted (`perform` resolves the message, or nothing), and the page's data
 * looked at again after.
 */
export function ActionButton({
  label, title, className = 'btn btn-action', perform, onDone,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
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
    <button type="button" className={className} title={title} disabled={action.isPending} onClick={() => action.mutate()}>
      {label}
    </button>
  );
}
