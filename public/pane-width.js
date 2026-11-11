/*
 * How wide the live terminal's pane is, when you drag its left edge or use the
 * arrow keys on it. The pane sits at the right of the window, EDGE px in from
 * each side. No DOM here, so it's tested in node.
 */

// The pane's margin from the window's edges (matches .glass-pane's inset).
export const EDGE = 12;
// Narrower than this and Claude's screen is too cramped to read.
export const MIN_WIDTH = 420;
// What the arrow keys move it by, and with Shift.
export const STEP = 40;
export const BIG_STEP = 160;
// The pane's width before you change it: about half the window.
const DEFAULT_MIN = 560;

const widest = (viewport) => viewport - 2 * EDGE;

/** A width the window has room for: at least MIN_WIDTH (if it fits), at most the window less its margins. */
export function clampWidth(width, viewport) {
  return Math.round(Math.min(widest(viewport), Math.max(MIN_WIDTH, width)));
}

/** The width it opens at, as the stylesheet had it: half the window, at least 560px. */
export function defaultWidth(viewport) {
  return Math.min(widest(viewport), Math.max(DEFAULT_MIN, Math.round(viewport / 2)));
}

/** Dragging the left edge to `clientX`: the pane spans from there to its right margin. */
export function pointerWidth(clientX, viewport) {
  return clampWidth(viewport - EDGE - clientX, viewport);
}

/** The width after a key on the edge, or null for keys that don't resize. The edge is on the left, so ← widens. */
export function keyWidth(width, { key, shiftKey = false }, viewport) {
  const step = shiftKey ? BIG_STEP : STEP;
  if (key === 'ArrowLeft') return clampWidth(width + step, viewport);
  if (key === 'ArrowRight') return clampWidth(width - step, viewport);
  if (key === 'Home') return widest(viewport);
  if (key === 'End') return clampWidth(MIN_WIDTH, viewport);
  return null;
}

/** The width you left it at last time, made to fit this window; the default when there's none. */
export function savedWidth(saved, viewport) {
  const width = Number.parseInt(saved, 10);
  return Number.isFinite(width) ? clampWidth(width, viewport) : defaultWidth(viewport);
}
