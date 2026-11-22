import type { ReactNode } from 'react';

/** What a list says when there's nothing in it (or nothing yet), centred and grey. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-6 text-center text-gray-500 text-sm [&_p]:mt-0 [&_p]:mb-2">{children}</div>;
}
