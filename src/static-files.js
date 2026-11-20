/*
 * The files the pages load, by URL path. Only these are served from public/,
 * so a page module that isn't listed here fails to load (test/static-files
 * checks every import is). The pages built from web/ are served from dist/
 * (see built-pages.js).
 */

export const STATIC_FILES = {
  '/graph': 'graph.html',
  '/graph.js': 'graph.js',
  '/graph-model.js': 'graph-model.js',
  '/vendor/cytoscape/cytoscape.esm.min.mjs': 'vendor/cytoscape/cytoscape.esm.min.mjs',
  '/nav.js': 'nav.js',
  '/actions.js': 'actions.js',
  '/alert-time.js': 'alert-time.js',
  '/dom.js': 'dom.js',
  '/styles.css': 'styles.css',
  '/themes.css': 'themes.css',
  // Sent with the Settings default filled in (see theme-boot.js), not as it is on disk.
  '/theme-boot.js': 'theme-boot.js',
  '/themes.js': 'themes.js',
  '/theme-menu.js': 'theme-menu.js',
  '/terminal-themes.js': 'terminal-themes.js',
  '/terminal-look.js': 'terminal-look.js',
  '/vendor/fonts/manrope.woff2': 'vendor/fonts/manrope.woff2',
  '/vendor/fonts/jetbrains-mono.woff2': 'vendor/fonts/jetbrains-mono.woff2',
  '/vendor/fonts/fraunces.woff2': 'vendor/fonts/fraunces.woff2',
  '/vendor/fonts/anton.woff2': 'vendor/fonts/anton.woff2',
};
