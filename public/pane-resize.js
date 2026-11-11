import { h, readPref, writePref } from './dom.js';
import { defaultWidth, keyWidth, MIN_WIDTH, pointerWidth, savedWidth } from './pane-width.js';

/*
 * The left edge of a glass pane, to make it wider or narrower: drag it, or
 * focus it and use the arrow keys (Shift for bigger steps, Home and End for
 * the widest and narrowest). Double-click goes back to the default width. The
 * width you leave it at is remembered in this browser, under `pref`.
 */

const viewport = () => document.documentElement.clientWidth;

/** The handle for `pane`, which also sets the pane to its remembered width. */
export function resizeHandle(pane, { pref, label }) {
  let handle = null;
  const width = () => Math.round(pane.getBoundingClientRect().width);

  function show(px) {
    pane.style.width = `${px}px`;
    handle.setAttribute('aria-valuenow', String(px));
    handle.setAttribute('aria-valuemax', String(Math.max(MIN_WIDTH, viewport() - 24)));
  }

  const remember = () => writePref(pref, String(width()));

  function endDrag(event) {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    remember();
  }

  handle = h('div', {
    class: 'pane-resize',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuemin': String(MIN_WIDTH),
    tabindex: '0',
    title: 'Drag to resize · double-click for the default width',
    onpointerdown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      pane.classList.add('is-resizing');
    },
    onpointermove: (event) => {
      if (handle.hasPointerCapture(event.pointerId)) show(pointerWidth(event.clientX, viewport()));
    },
    onpointerup: endDrag,
    onpointercancel: endDrag,
    onlostpointercapture: () => pane.classList.remove('is-resizing'),
    ondblclick: () => {
      show(defaultWidth(viewport()));
      writePref(pref, '');
    },
    onkeydown: (event) => {
      const next = keyWidth(width(), event, viewport());
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      show(next);
      remember();
    },
  });
  show(savedWidth(readPref(pref, null), viewport()));
  return handle;
}
