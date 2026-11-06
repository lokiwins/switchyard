import { randomBytes } from 'node:crypto';

/* The pages' Content-Security-Policy: scripts, styles and connections from switchyard only. */

export const CSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const newStyleNonce = () => randomBytes(16).toString('base64');

/**
 * A page that hosts the live terminal. xterm.js creates a <style> element for
 * its scrollable viewport, so the page gets a fresh nonce on each load: in the
 * policy, and in a <meta name="style-nonce"> the page stamps on that element.
 * Any other inline style, including injected ones, stays blocked.
 */
export function withStyleNonce(html, nonce) {
  return {
    csp: `${CSP}; style-src 'self' 'nonce-${nonce}'`,
    body: html.replace('</head>', `  <meta name="style-nonce" content="${nonce}">\n</head>`),
  };
}
