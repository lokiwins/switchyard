import { expect, test } from 'vitest';
import {
  EDGE, MIN_WIDTH, STEP, BIG_STEP, clampWidth, defaultWidth, keyWidth, pointerWidth, savedWidth,
} from './pane-width';

test('the default width is half the window, at least 560px, and never wider than the window allows', () => {
  expect(defaultWidth(1600)).toBe(800);
  expect(defaultWidth(1000)).toBe(560);
  expect(defaultWidth(500)).toBe(500 - 2 * EDGE);
});

test('a width stays between the minimum and the window less its margins', () => {
  expect(clampWidth(200, 1600)).toBe(MIN_WIDTH);
  expect(clampWidth(5000, 1600)).toBe(1600 - 2 * EDGE);
  expect(clampWidth(900.6, 1600), 'whole pixels').toBe(901);
  // A window too narrow for the minimum gets what it has.
  expect(clampWidth(MIN_WIDTH, 400)).toBe(400 - 2 * EDGE);
});

test('dragging the left edge: the pane runs from the pointer to its right margin', () => {
  expect(pointerWidth(600, 1600)).toBe(1600 - EDGE - 600);
  expect(pointerWidth(-50, 1600), 'past the left edge: as wide as it goes').toBe(1600 - 2 * EDGE);
  expect(pointerWidth(1500, 1600), 'past the minimum: the minimum').toBe(MIN_WIDTH);
});

test('arrow keys widen (left) and narrow (right) the pane; Shift takes bigger steps; Home and End go to the ends', () => {
  expect(keyWidth(800, { key: 'ArrowLeft' }, 1600)).toBe(800 + STEP);
  expect(keyWidth(800, { key: 'ArrowRight' }, 1600)).toBe(800 - STEP);
  expect(keyWidth(800, { key: 'ArrowLeft', shiftKey: true }, 1600)).toBe(800 + BIG_STEP);
  expect(keyWidth(800, { key: 'Home' }, 1600)).toBe(1600 - 2 * EDGE);
  expect(keyWidth(800, { key: 'End' }, 1600)).toBe(MIN_WIDTH);
  expect(keyWidth(800, { key: 'Enter' }, 1600), 'other keys are not ours').toBe(null);
});

test('a saved width is used when it is a number, clamped to this window', () => {
  expect(savedWidth('900', 1600)).toBe(900);
  expect(savedWidth('3000', 1600)).toBe(1600 - 2 * EDGE);
  expect(savedWidth(null, 1600)).toBe(defaultWidth(1600));
  expect(savedWidth('wide', 1600)).toBe(defaultWidth(1600));
});
