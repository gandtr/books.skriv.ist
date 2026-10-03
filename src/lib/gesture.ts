// Touch page turns for the reader: a quick horizontal swipe on the page, or a tap
// near its left or right edge. Touch only: mouse and pen keep the arrow buttons and
// keys, so a double-click or a Pencil drag still selects text.

export interface PageGesture {
  width: number; // page width in px
  startX: number; // finger x relative to the page, at down and at up
  endX: number;
  dy: number; // vertical travel
  ms: number; // press duration
  selecting: boolean; // text is selected (making a note)
  onLink: boolean; // the press started on a link or control
}

const SWIPE_PX = 40;
const SWIPE_MS = 600;
const TAP_PX = 10;
const TAP_MS = 500;
const EDGE = 0.2;

/** 1 (next), -1 (previous) or 0 (leave it) for one finished press. */
export function pageGesture(g: PageGesture): -1 | 0 | 1 {
  if (g.selecting) return 0;
  const dx = g.endX - g.startX;
  if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(g.dy) && g.ms <= SWIPE_MS)
    return dx < 0 ? 1 : -1;
  if (Math.abs(dx) <= TAP_PX && Math.abs(g.dy) <= TAP_PX && g.ms <= TAP_MS && !g.onLink) {
    if (g.startX < g.width * EDGE) return -1;
    if (g.startX > g.width * (1 - EDGE)) return 1;
  }
  return 0;
}

interface Down {
  id: number;
  x: number;
  y: number;
  t: number;
  primary: boolean;
  type: string; // PointerEvent.pointerType
  onLink: boolean;
}
interface Up {
  id: number;
  x: number;
  y: number;
  t: number;
  left: number; // page box
  width: number;
  selecting: boolean;
}

/** Follows one finger from down to up; a second finger anywhere in between cancels it. */
export class PageGestureTracker {
  private press: Down | undefined;
  private multi = false;

  down(p: Down) {
    if (p.type !== 'touch') return;
    if (this.press || !p.primary) {
      this.multi = true;
      return;
    }
    this.press = p;
    this.multi = false;
  }

  up(p: Up): -1 | 0 | 1 {
    const start = this.press;
    if (!start || p.id !== start.id) return 0;
    this.press = undefined;
    if (this.multi) {
      this.multi = false;
      return 0;
    }
    return pageGesture({
      width: p.width,
      startX: start.x - p.left,
      endX: p.x - p.left,
      dy: p.y - start.y,
      ms: p.t - start.t,
      selecting: p.selecting,
      onLink: start.onLink,
    });
  }

  cancel() {
    this.press = undefined;
    this.multi = false;
  }
}

/** Whether text is selected, including inside a shadow root, where WebKit reports
 *  the Selection as collapsed and only getComposedRanges() sees it. */
export function hasSelection(selection: Selection | null, root?: ShadowRoot): boolean {
  if (!selection) return false;
  const composed = (
    selection as Selection & {
      getComposedRanges?: (o: { shadowRoots: ShadowRoot[] }) => { collapsed: boolean }[];
    }
  ).getComposedRanges;
  if (composed && root) {
    try {
      if (composed.call(selection, { shadowRoots: [root] }).some((r) => !r.collapsed)) return true;
    } catch {
      // Older engines take positional shadow roots or none; fall through.
    }
  }
  return !selection.isCollapsed;
}
