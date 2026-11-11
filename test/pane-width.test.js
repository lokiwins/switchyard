import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EDGE, MIN_WIDTH, STEP, BIG_STEP, clampWidth, defaultWidth, keyWidth, pointerWidth, savedWidth,
} from '../public/pane-width.js';

test('the default width is half the window, at least 560px, and never wider than the window allows', () => {
  assert.equal(defaultWidth(1600), 800);
  assert.equal(defaultWidth(1000), 560);
  assert.equal(defaultWidth(500), 500 - 2 * EDGE);
});

test('a width stays between the minimum and the window less its margins', () => {
  assert.equal(clampWidth(200, 1600), MIN_WIDTH);
  assert.equal(clampWidth(5000, 1600), 1600 - 2 * EDGE);
  assert.equal(clampWidth(900.6, 1600), 901, 'whole pixels');
  // A window too narrow for the minimum gets what it has.
  assert.equal(clampWidth(MIN_WIDTH, 400), 400 - 2 * EDGE);
});

test('dragging the left edge: the pane runs from the pointer to its right margin', () => {
  assert.equal(pointerWidth(600, 1600), 1600 - EDGE - 600);
  assert.equal(pointerWidth(-50, 1600), 1600 - 2 * EDGE, 'past the left edge: as wide as it goes');
  assert.equal(pointerWidth(1500, 1600), MIN_WIDTH, 'past the minimum: the minimum');
});

test('arrow keys widen (left) and narrow (right) the pane; Shift takes bigger steps; Home and End go to the ends', () => {
  assert.equal(keyWidth(800, { key: 'ArrowLeft' }, 1600), 800 + STEP);
  assert.equal(keyWidth(800, { key: 'ArrowRight' }, 1600), 800 - STEP);
  assert.equal(keyWidth(800, { key: 'ArrowLeft', shiftKey: true }, 1600), 800 + BIG_STEP);
  assert.equal(keyWidth(800, { key: 'Home' }, 1600), 1600 - 2 * EDGE);
  assert.equal(keyWidth(800, { key: 'End' }, 1600), MIN_WIDTH);
  assert.equal(keyWidth(800, { key: 'Enter' }, 1600), null, 'other keys are not ours');
});

test('a saved width is used when it is a number, clamped to this window', () => {
  assert.equal(savedWidth('900', 1600), 900);
  assert.equal(savedWidth('3000', 1600), 1600 - 2 * EDGE);
  assert.equal(savedWidth(null, 1600), defaultWidth(1600));
  assert.equal(savedWidth('wide', 1600), defaultWidth(1600));
});
