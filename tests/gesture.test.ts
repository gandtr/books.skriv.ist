import { expect, it } from 'vitest';
import { hasSelection, pageGesture, PageGestureTracker } from '../src/lib/gesture';

const W = 400; // page width
const base = { width: W, startX: 200, endX: 200, dy: 0, ms: 150, selecting: false, onLink: false };

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

const down = (id: number, x: number, more: Partial<Parameters<PageGestureTracker['down']>[0]> = {}) =>
  ({ id, x, y: 300, t: 0, primary: id === 1, type: 'touch', onLink: false, ...more });
const up = (id: number, x: number, t = 150) => ({ id, x, y: 300, t, left: 0, width: W, selecting: false });

it('the tracker turns on a single-finger swipe or edge tap', () => {
  const g = new PageGestureTracker();
  g.down(down(1, 300));
  expect(g.up(up(1, 220))).toBe(1);
  g.down(down(1, 390));
  expect(g.up(up(1, 390))).toBe(1);
});

it('a second finger cancels the gesture, whichever finger lifts first', () => {
  const g = new PageGestureTracker();
  g.down(down(1, 200));
  g.down(down(2, 390));
  expect(g.up(up(2, 390))).toBe(0); // second finger tapped an edge
  expect(g.up(up(1, 120))).toBe(0); // first finger "swiped"
  g.down(down(1, 300)); // and the next clean gesture works again
  expect(g.up(up(1, 220))).toBe(1);
});

it('only touch turns pages: mouse and pen keep the buttons and keys', () => {
  const g = new PageGestureTracker();
  g.down(down(1, 390, { type: 'mouse' }));
  expect(g.up(up(1, 390))).toBe(0);
  g.down(down(1, 300, { type: 'pen' }));
  expect(g.up(up(1, 220))).toBe(0);
});

it('a cancelled press does nothing', () => {
  const g = new PageGestureTracker();
  g.down(down(1, 300));
  g.cancel();
  expect(g.up(up(1, 220))).toBe(0);
});

it('sees a selection inside a shadow root even when Selection reports it collapsed (WebKit)', () => {
  const root = {} as ShadowRoot;
  const collapsedButComposed = {
    isCollapsed: true,
    getComposedRanges: () => [{ collapsed: false }],
  } as unknown as Selection;
  expect(hasSelection(collapsedButComposed, root)).toBe(true);
  expect(hasSelection({ isCollapsed: true, getComposedRanges: () => [{ collapsed: true }] } as unknown as Selection, root)).toBe(false);
  expect(hasSelection({ isCollapsed: false } as Selection, root)).toBe(true);
  expect(hasSelection(null, root)).toBe(false);
});
