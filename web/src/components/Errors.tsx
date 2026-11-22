export interface PageError { source: string; message: string }

/** What went wrong getting the page's data: the server's own errors, and a failed load. `bare` shows the messages alone. */
export function Errors({ errors, bare = false }: { errors: PageError[]; bare?: boolean }) {
  return (
    <div
      id="errors"
      className="px-3 py-2 rounded-sm bg-red-soft text-red shadow-[inset_3px_0_0_var(--red)] text-sm"
      hidden={errors.length === 0}
    >
      {errors.map((e, i) => <div key={i}>{bare ? e.message : `${e.source}: ${e.message}`}</div>)}
    </div>
  );
}

/** Messages alone, as errors to show bare. */
export const messages = (list: string[]): PageError[] => list.map((message) => ({ source: '', message }));

/** The page's errors with a failed load's added, as "monitor: Could not load …". */
export const pageErrors = (errors: PageError[] | undefined, loadError: Error | null, what: string): PageError[] => [
  ...(errors ?? []),
  ...(loadError ? [{ source: 'monitor', message: `Could not load ${what}: ${loadError.message}` }] : []),
];
