import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as model from '../../../../public/graph-model.js';
import { cssSource } from '../../styles/source';
import { kindFillClass, kindSwatchClass } from './kinds';

/*
 * Each kind's colour is a token (--graph-prompt, …) in themes.css, light and
 * dark; the swatches and the share bar take it through a class per kind, as
 * literal class names Tailwind can find.
 */

const KINDS = model.KINDS as Record<string, { color: string }>;
const TOKEN_KINDS = model.TOKEN_KINDS as { kind: string; color: string }[];

describe('the kinds\' colours', () => {
  it('give every node kind a swatch in its own colour', () => {
    for (const [kind, { color }] of Object.entries(KINDS)) {
      expect(kindSwatchClass(kind), kind).toContain(`bg-[var(${color})]`);
    }
  });

  it('give every part of the context a segment of the bar in its own colour, and anything else the grey of "other"', () => {
    for (const { kind, color } of TOKEN_KINDS) expect(kindFillClass(kind), kind).toContain(`fill-[var(${color})]`);
    expect(kindFillClass('other')).toContain('fill-[var(--graph-other)]');
    expect(kindFillClass('nonsense')).toContain('fill-[var(--graph-other)]');
    expect(kindSwatchClass('nonsense')).toContain('bg-[var(--graph-other)]');
  });

  it('are set in themes.css, for light and again for dark', () => {
    const themes = cssSource('themes');
    for (const { color } of [...Object.values(KINDS), ...TOKEN_KINDS]) expect(themes, color).toContain(`${color}:`);
    expect(themes).toMatch(/:root\[data-scheme="dark"\] \{\s*--graph-prompt:/);
  });
});

describe('legacy.css', () => {
  it('is gone, and nothing imports it', () => {
    const dir = process.env.STYLES_DIR ?? '';
    expect(existsSync(join(dir, 'legacy.css'))).toBe(false);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/legacy/);
    }
  });
});
