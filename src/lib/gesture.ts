// Touch and tap page turns for the reader: a quick horizontal swipe on the page, or
// a tap near its left or right edge. Returns 1 (next), -1 (previous) or 0 (leave it).
export interface PageGesture {
  width: number; // page width in px
  startX: number; // pointer x relative to the page, at down and at up
  endX: number;
  dy: number; // vertical travel
  ms: number; // press duration
  selecting: boolean; // text is selected (making a note)
  onLink: boolean; // the press started on a link
  touch: boolean; // finger or pen; a mouse drag selects text instead of swiping
}

const SWIPE_PX = 40;
const SWIPE_MS = 600;
const TAP_PX = 10;
const TAP_MS = 500;
const EDGE = 0.2;

export function pageGesture(g: PageGesture): -1 | 0 | 1 {
  if (g.selecting) return 0;
  const dx = g.endX - g.startX;
  if (g.touch && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(g.dy) && g.ms <= SWIPE_MS)
    return dx < 0 ? 1 : -1;
  if (Math.abs(dx) <= TAP_PX && Math.abs(g.dy) <= TAP_PX && g.ms <= TAP_MS && !g.onLink) {
    if (g.startX < g.width * EDGE) return -1;
    if (g.startX > g.width * (1 - EDGE)) return 1;
  }
  return 0;
}
