/*
 * Class lists for patterns too small to be components of their own, shared by
 * the pages.
 */

/** A list of rows split by hairlines, without bullets or indent. */
export const stackedListClass = 'list-none m-0 p-0 [&>li+li]:border-t [&>li+li]:border-divider';

/** The row of filters beside a panel's title (search, Show). */
export const filtersClass = 'flex flex-wrap items-center gap-2';

/** A fact in a line of facts, after a grey "·" (a PR's author, when it was updated). */
export const sepClass = "before:content-['·'] before:text-gray-400 before:mr-1.5";

/** Lines added or removed: small bold figures in the monospace face, green or red. */
export const addedClass = 'tabular-nums font-mono text-[11.5px] font-semibold text-green';
export const removedClass = 'tabular-nums font-mono text-[11.5px] font-semibold text-red';

/** "Show 3 more" under a list: a quiet full-width button. */
export const listToggleClass = [
  'block w-full mt-0.5 py-1.5 px-2 border-0 rounded-sm bg-transparent cursor-pointer text-left',
  '[font-family:inherit] [line-height:inherit] text-xs font-semibold text-gray-500 hover:bg-hover hover:text-gray-900',
].join(' ');
