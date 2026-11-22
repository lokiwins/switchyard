import { useEffect } from 'react';
import { toastDuration, useToastStore } from '../stores/toast';

/** The page's one toast, at the bottom in the middle; it goes after a while, or when its action is taken. */
export function Toast() {
  const current = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (!current) return undefined;
    const timer = setTimeout(() => dismiss(current.id), toastDuration(current));
    return () => clearTimeout(timer);
  }, [current, dismiss]);
  return (
    <div
      id="toast"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-sm bg-gray-900 text-surface text-sm font-medium shadow-(--shadow-md)"
      role="status"
      hidden={!current}
    >
      {current?.message}
      {current?.action && (
        <button
          type="button"
          className="ml-3 p-0 border-0 bg-transparent [font-family:inherit] [font-size:inherit] [line-height:inherit] font-semibold [color:inherit] underline cursor-pointer"
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
