import { expect, it } from 'vitest';
import { pageGesture } from '../src/lib/gesture';

const W = 400; // page width
const base = { width: W, startX: 200, endX: 200, dy: 0, ms: 150, selecting: false, onLink: false, touch: true };

it('turns forward on a left swipe and back on a right swipe', () => {
  expect(pageGesture({ ...base, startX: 300, endX: 220 })).toBe(1);
  expect(pageGesture({ ...base, startX: 100, endX: 180 })).toBe(-1);
});

it('ignores short, slow or mostly vertical swipes', () => {
  expect(pageGesture({ ...base, startX: 200, endX: 170 })).toBe(0); // 30 px
  expect(pageGesture({ ...base, startX: 300, endX: 220, ms: 900 })).toBe(0); // too slow
  expect(pageGesture({ ...base, startX: 300, endX: 220, dy: 90 })).toBe(0); // scrolling
});

it('turns on a tap in the outer fifth of the page', () => {
  expect(pageGesture({ ...base, startX: 20, endX: 22 })).toBe(-1);
  expect(pageGesture({ ...base, startX: 390, endX: 388 })).toBe(1);
  expect(pageGesture({ ...base, startX: 200, endX: 201 })).toBe(0); // middle
});

it('leaves taps alone when they are long presses, on links, or selecting text', () => {
  expect(pageGesture({ ...base, startX: 390, endX: 390, ms: 700 })).toBe(0);
  expect(pageGesture({ ...base, startX: 390, endX: 390, onLink: true })).toBe(0);
  expect(pageGesture({ ...base, startX: 390, endX: 390, selecting: true })).toBe(0);
  expect(pageGesture({ ...base, startX: 300, endX: 220, selecting: true })).toBe(0);
});

it('only touch swipes turn; a mouse drag never does, but a mouse click on an edge does', () => {
  expect(pageGesture({ ...base, startX: 300, endX: 220, touch: false })).toBe(0);
  expect(pageGesture({ ...base, startX: 390, endX: 390, touch: false })).toBe(1);
});
