import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { defaultWidth, EDGE, keyWidth, MIN_WIDTH, pointerWidth, savedWidth } from '../../../public/pane-width.js';
import { readPref, writePref } from '../lib/prefs';

/*
 * The left edge of a glass pane, to make it wider or narrower: drag it, or
 * focus it and use the arrow keys (Shift for bigger steps, Home and End for
 * the widest and narrowest). Double-click goes back to the default width. The
 * width you leave it at is remembered in this browser, under `prefKey`.
 *
 * It sits directly in the pane (the <dialog>) and sizes its parent element,
 * through the CSSOM, which the page's policy allows.
 */

/*
 * A 10px strip down the pane's left edge; a thin line in it lights up under
 * the pointer, on focus and while dragged. A pane fills a phone's screen
 * already, so there it isn't shown.
 */
const EDGE_CLASS = [
  'absolute z-2 inset-y-0 left-0 w-2.5 cursor-col-resize touch-none outline-none max-phone:hidden',
  "after:content-[''] after:absolute after:top-4 after:bottom-4 after:left-[3px] after:w-0.5 after:rounded-[1px]",
  'after:bg-pane-edge after:opacity-0 after:[transition:opacity_120ms_ease]',
  'hover:after:opacity-100 hover:after:bg-pane-accent hover:after:shadow-[0_0_8px_var(--pane-accent-strong)]',
  'focus-visible:after:opacity-100 focus-visible:after:bg-pane-accent focus-visible:after:shadow-[0_0_8px_var(--pane-accent-strong)]',
  'group-data-resizing/pane:after:opacity-100 group-data-resizing/pane:after:bg-pane-accent group-data-resizing/pane:after:shadow-[0_0_8px_var(--pane-accent-strong)]',
].join(' ');

const viewport = () => document.documentElement.clientWidth;

interface Shown { now: number; max: number }
const shown = (px: number): Shown => ({ now: px, max: Math.max(MIN_WIDTH, viewport() - 2 * EDGE) });

export function ResizeHandle({ prefKey, label }: { prefKey: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => shown(savedWidth(readPref(prefKey), viewport())));
  const pane = () => ref.current?.parentElement ?? null;
  const measured = () => Math.round(pane()?.getBoundingClientRect().width ?? width.now);
  const size = (px: number) => {
    const element = pane();
    if (element) element.style.width = `${px}px`;
  };
  const show = (px: number) => {
    size(px);
    setWidth(shown(px));
  };
  const remember = () => writePref(prefKey, String(measured()));

  // The pane opens at the width remembered (the initial state); after that, show() sets it as it changes.
  const initial = useRef(width.now);
  useLayoutEffect(() => {
    const element = ref.current?.parentElement;
    if (element) element.style.width = `${initial.current}px`;
  }, []);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    remember();
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pane()?.setAttribute('data-resizing', '');
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) show(pointerWidth(event.clientX, viewport()));
  };
  const resetWidth = () => {
    show(defaultWidth(viewport()));
    writePref(prefKey, '');
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyWidth(measured(), event, viewport());
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    show(next);
    remember();
  };

  return (
    <div
      ref={ref}
      className={EDGE_CLASS}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={MIN_WIDTH}
      aria-valuenow={width.now}
      aria-valuemax={width.max}
      tabIndex={0}
      title="Drag to resize · double-click for the default width"
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => pane()?.removeAttribute('data-resizing')}
      onDoubleClick={resetWidth}
      onKeyDown={onKey}
    />
  );
}
