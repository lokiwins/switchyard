import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, fieldSelectClass } from '../../components/Field';
import { cssSource } from '../../styles/source';
import { SessionRow, type RowProps } from './Row';

afterEach(cleanup);

const legacy = cssSource('legacy');
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

const BASE: RowProps = {
  badge: <span>Working</span>, title: 'Fix the login redirect', where: 'storefront', detail: { kind: 'activity', text: 'Editing redirect.js' },
  since: Date.now(), timeHint: 'since now', actions: <button type="button">Jump</button>,
};

const row = (props: Partial<RowProps> = {}) => render(<ul><SessionRow {...BASE} {...props} /></ul>);

describe('SessionRow', () => {
  it('stacks on a phone: status and title, then what it is doing, then its buttons; narrower than a tablet it drops the time', () => {
    row();
    const li = screen.getByRole('listitem');
    expect(classes(li)).toContain('max-phone:grid-cols-[auto_minmax(0,1fr)]');
    expect(classes(screen.getByText('Editing redirect.js'))).toEqual(expect.arrayContaining(['max-phone:[grid-column:1/-1]', 'max-tablet:row-start-2']));
    expect(classes(screen.getByRole('button', { name: 'Jump' }).parentElement)).toContain('max-phone:row-start-3');
    expect(classes(li.querySelector('[title="since now"]'))).toContain('max-tablet:hidden');
  });

  it('keeps a state tint under the pointer, and lights up a plain row', () => {
    row({ tone: 'interrupted' });
    expect(classes(screen.getByRole('listitem')).some((c) => c.startsWith('hover:'))).toBe(false);
    cleanup();
    row();
    expect(classes(screen.getByRole('listitem'))).toContain('hover:bg-hover');
  });

  it('colours a detail by what it is, and a failed start\'s line red', () => {
    row();
    expect(classes(screen.getByText('Editing redirect.js'))).toContain('text-green');
    cleanup();
    row({ tone: 'exited', detail: { kind: 'pending', text: 'Claude quit' } });
    const line = screen.getByText('Claude quit');
    expect(classes(line)).toContain('text-red');
    expect(classes(line)).not.toContain('italic');
  });

  it('opens a long detail in place, and the row lines up at its top while it is open', () => {
    const onToggle = vi.fn();
    row({ detail: { kind: 'reply', text: 'A long reply' }, onDetailToggle: onToggle, detailOpen: true });
    const button = screen.getByRole('button', { name: /A long reply/ });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.hasAttribute('data-detail-open')).toBe(true);
    expect(classes(button)).toContain('whitespace-pre-wrap');
    expect(classes(screen.getByRole('listitem'))).toContain('has-[[data-detail-open]]:items-start');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('puts a note under the detail, in a cell placed as the detail would be', () => {
    row({ note: 'Answer it in its terminal' });
    const cell = screen.getByText('Answer it in its terminal').parentElement;
    expect(classes(cell)).toContain('max-phone:row-start-2');
  });
});

describe('Field', () => {
  it('a select leaves room for its arrow and sets only its background colour, so the arrow stays', () => {
    render(<Field label="Repository"><select className={fieldSelectClass}><option>a</option></select></Field>);
    const select = screen.getByRole('combobox', { name: 'Repository' });
    expect(classes(select)).toEqual(expect.arrayContaining(['pr-[26px]', 'bg-surface']));
  });
});

describe('legacy.css', () => {
  it('no longer styles the Agents page\'s menus, forms and alerts', () => {
    for (const selector of ['.end-panel', '.delete-panel', '.delete-choice', '.reply-form', '.task-form', '.task-field', '.task-check', '.answer-panel', '.hint', '.list-toggle', '.row-alerts', '.session-alert']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(legacy, selector).not.toMatch(new RegExp(`${escaped}(?![\\w-])`));
    }
  });
});
