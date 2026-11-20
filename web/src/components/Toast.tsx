import { useEffect } from 'react';
import { toastDuration, useToastStore } from '../stores/toast';

/** The page's one toast; it goes after a while, or when its action is taken. */
export function Toast() {
  const current = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (!current) return undefined;
    const timer = setTimeout(() => dismiss(current.id), toastDuration(current));
    return () => clearTimeout(timer);
  }, [current, dismiss]);
  return (
    <div id="toast" className="toast" role="status" hidden={!current}>
      {current?.message}
      {current?.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            dismiss(current.id);
            current.action?.run();
          }}
        >
          {current.action.label}
        </button>
      )}
    </div>
  );
}
