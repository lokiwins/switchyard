/*
 * What the pages load from public/, by URL path: the stylesheets with every
 * theme's colours, the theme boot script and the theme fonts. Only these are
 * served from there. The pages themselves are built from web/ and served from
 * dist/ (see built-pages.js).
 */

export const STATIC_FILES = {
  '/styles.css': 'styles.css',
  '/themes.css': 'themes.css',
  // Sent with the Settings default filled in (see theme-boot.js), not as it is on disk.
  '/theme-boot.js': 'theme-boot.js',
  '/vendor/fonts/manrope.woff2': 'vendor/fonts/manrope.woff2',
  '/vendor/fonts/jetbrains-mono.woff2': 'vendor/fonts/jetbrains-mono.woff2',
  '/vendor/fonts/fraunces.woff2': 'vendor/fonts/fraunces.woff2',
  '/vendor/fonts/anton.woff2': 'vendor/fonts/anton.woff2',
};
