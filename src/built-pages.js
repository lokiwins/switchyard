/*
 * The pages built from web/ (npm run build) into dist/: the page itself by
 * its URL, and its scripts and styles under /assets/, named by their content
 * (agents-4GCvw0nE.js), so they can be cached for good. Only a plain file name
 * in /assets/ is served: no folders, no dots before the name, no source maps.
 */

export const BUILT_PAGES = { '/': 'agents.html', '/prs': 'prs.html', '/worktrees': 'worktrees.html' };

const ASSET = /^\/assets\/[A-Za-z0-9][\w-]*\.(js|css|woff2)$/;

/** The file in dist/ for a URL path, and whether it's a page; null when the build doesn't serve it. */
export function builtFile(pathname) {
  if (Object.hasOwn(BUILT_PAGES, pathname)) return { file: BUILT_PAGES[pathname], page: true };
  if (ASSET.test(pathname)) return { file: pathname.slice(1), page: false };
  return null;
}
