import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cssSource } from '../styles/source';
import { Dialog, PaneHeader } from './Dialog';
import { Markdown } from './Markdown';
import { paneButtonClass, paneInputClass } from './pane-classes';
import { ResizeHandle } from './ResizeHandle';

/*
 * The glass panes and the Markdown in them carry their own look as utilities.
 * These check what a screenshot can't: the states (dragging, live, a primary
 * button).
 */

afterEach(cleanup);

const base = cssSource('base');
const app = cssSource('app');
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

beforeAll(() => {
  // jsdom has no modal dialogs or pointer capture.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  let captured: number | null = null;
  Element.prototype.setPointerCapture = function set(id: number) { captured = id; };
  Element.prototype.hasPointerCapture = function has(id: number) { return captured === id; };
  Element.prototype.releasePointerCapture = function release(this: Element) {
    captured = null;
    this.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
  };
});

describe('Dialog', () => {
  it('is the glass: fixed to the right, sliding in unless motion is reduced', () => {
    render(<Dialog label="Plan" onClose={vi.fn()}><p>Body</p></Dialog>);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(classes(dialog)).toEqual(expect.arrayContaining(['fixed', 'open:flex', 'open:flex-col', 'motion-safe:open:animate-pane-in']));
    expect(classes(dialog).some((c) => c.startsWith('backdrop:bg-'))).toBe(true);
  });

  it('is marked while its edge is dragged, and the edge lights up then', () => {
    render(<Dialog label="Terminal" onClose={vi.fn()}><ResizeHandle prefKey="test.width" label="Width" /></Dialog>);
    const dialog = screen.getByRole('dialog', { hidden: true });
    const edge = screen.getByRole('separator', { hidden: true });
    expect(classes(dialog)).toEqual(expect.arrayContaining(['data-resizing:cursor-col-resize', 'data-resizing:select-none']));
    expect(classes(edge)).toContain('group-data-resizing/pane:after:opacity-100');
    // A pane fills a phone's screen already: there's nothing to drag.
    expect(classes(edge)).toContain('max-phone:hidden');
    fireEvent.pointerDown(edge, { button: 0, pointerId: 1 });
    expect(dialog.hasAttribute('data-resizing')).toBe(true);
    fireEvent.pointerUp(edge, { pointerId: 1 });
    expect(dialog.hasAttribute('data-resizing')).toBe(false);
  });
});

describe('PaneHeader', () => {
  it('shows the dot in its state: waiting amber, live green, otherwise dim', () => {
    const dot = (state?: 'waiting' | 'live') => {
      cleanup();
      render(<PaneHeader heading="Review" dot={state} />);
      return classes(screen.getByRole('banner').firstElementChild);
    };
    expect(dot('waiting')).toContain('bg-pane-wait');
    expect(dot('live')).toContain('bg-pane-ok');
    expect(dot()).toContain('bg-pane-dim');
  });
});

describe('pane controls', () => {
  it('give a primary button its own fill, not two', () => {
    const plain = paneButtonClass().split(' ');
    const primary = paneButtonClass({ primary: true }).split(' ');
    expect(primary.filter((c) => c.startsWith('bg-'))).toHaveLength(1);
    expect(plain.filter((c) => c.startsWith('bg-'))).toHaveLength(1);
    expect(primary).not.toEqual(plain);
  });

  it('keep a box of several lines at its own line height, and a one-line box at the form controls\' own', () => {
    const lines = paneInputClass({ field: true, lines: true }).split(' ');
    expect(lines).toEqual(expect.arrayContaining(['leading-[1.5]', 'resize-y']));
    expect(lines).not.toContain('[line-height:normal]');
    expect(paneInputClass().split(' ')).toContain('[line-height:normal]');
  });

  it('size a field\'s input a step up from a footer\'s', () => {
    expect(paneInputClass().split(' ')).toContain('text-xs');
    expect(paneInputClass({ field: true }).split(' ')).toContain('text-sm');
    expect(paneInputClass({ field: true }).split(' ')).not.toContain('text-xs');
  });
});

describe('Markdown', () => {
  it('sets a list item\'s paragraphs tight and a task item without its bullet', () => {
    render(<Markdown text={'- [x] done\n- plain'} />);
    const list = screen.getByRole('list');
    expect(classes(list)).toContain('[&>li>p]:m-0');
    expect(classes(screen.getByRole('checkbox').closest('li'))).toContain('list-none');
  });

  it('keeps a list\'s bullets and numbers, and the smaller headings bold', () => {
    render(<Markdown text={'- a\n- b\n\n1. one\n2. two\n\n#### Four'} />);
    const [bullets, numbers] = screen.getAllByRole('list');
    expect(classes(bullets ?? null)).toContain('list-disc');
    expect(classes(numbers ?? null)).toContain('list-decimal');
    expect(classes(screen.getByRole('heading', { name: 'Four' }))).toContain('font-bold');
  });

  it('drops the top margin of whatever comes first', () => {
    render(<Markdown text={'# Title\n\nText'} />);
    expect(classes(screen.getByRole('heading', { name: 'Title' }))).toContain('first:mt-0');
  });

  it('comes a size down in a ticket', () => {
    const { container } = render(<Markdown text="Text" size="sm" />);
    expect(classes(container.firstElementChild)).toContain('text-sm');
    expect(classes(container.firstElementChild)).not.toContain('text-base');
  });
});

describe('the styles', () => {
  it('keep the page behind an open pane still', () => {
    expect(base).toMatch(/html:has\(dialog:modal\)\s*\{\s*overflow:\s*hidden;?\s*\}/);
  });

  it('put Tailwind\'s base reset under the page\'s own element styles, which give every box the same hint colour', () => {
    const imports = [...app.matchAll(/@import "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.indexOf('tailwindcss/preflight.css')).toBeGreaterThan(-1);
    expect(imports.indexOf('tailwindcss/preflight.css')).toBeLessThan(imports.indexOf('./base.css'));
    expect(app).toMatch(/@import "tailwindcss\/preflight.css" layer\(base\);/);
    expect(base).toMatch(/::placeholder\s*\{\s*color:\s*var\(--gray-400\);?\s*\}/);
  });

  it('define the pane\'s slide-in', () => {
    expect(app).toMatch(/--animate-pane-in:/);
    expect(app).toMatch(/@keyframes pane-slide-in/);
  });

});
