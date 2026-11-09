/**
 * Hover dwell for the insertion intent (baseline 6.2).
 *
 * The gutter between two cells is only 4-16px wide, and `hitCell` reports
 * `inGapX`/`inGapY` the instant the pointer crosses one cell edge into it.
 * Turning that straight into a push made the grid feel hair-triggered: any
 * small wobble while aiming for an exact spot displaced the neighbours, so
 * precise placement became impossible.
 *
 * Dwell fixes the *timing* rather than the geometry. Widening the gutter would
 * only make "which cell am I over" blurrier — the wrong knob. Instead the
 * pointer must stay on the same gutter cell for `INSERT_DWELL_MS` before the
 * insertion becomes a real intent. Sweeping across a gutter (normal when aiming
 * at a neighbour) never accumulates, because leaving resets the timer.
 *
 * Pure and time-injected so the whole rule is testable without a browser.
 */

/** How long the pointer must hold still on the gutter before pushing. */
export const INSERT_DWELL_MS = 380;

/**
 * Slack for a pointer that is *almost* still.
 *
 * A held mouse still emits events with a pixel or two of jitter (and a
 * trackpad/high-DPI device emits more), so an exact position match would reset
 * the timer forever and dwell would never complete. Movement within this radius
 * of the anchor point counts as "still".
 */
export const INSERT_DWELL_SLOP_PX = 4;

export interface DwellKey {
  /** Grid cell the gutter belongs to. */
  readonly cellX: number;
  readonly cellY: number;
  /** Which gutter, and in which direction — a vertical and a horizontal
   *  gutter at the same cell are different targets. */
  readonly axis: 'x' | 'y';
}

export interface DwellState {
  readonly key: DwellKey;
  /** Local pointer position when the dwell started. */
  readonly anchorX: number;
  readonly anchorY: number;
  readonly since: number;
}

export function dwellKeyFor(hit: { readonly cell: { readonly x: number; readonly y: number }; readonly inGapX: boolean; readonly inGapY: boolean }): DwellKey | undefined {
  // Vertical gutter (between rows) is the more common insertion gesture, so it
  // wins when the pointer is somehow in both at once (a corner).
  if (hit.inGapY) return { cellX: hit.cell.x, cellY: hit.cell.y, axis: 'y' };
  if (hit.inGapX) return { cellX: hit.cell.x, cellY: hit.cell.y, axis: 'x' };
  return undefined;
}

function sameKey(left: DwellKey | undefined, right: DwellKey): boolean {
  return left !== undefined && left.cellX === right.cellX && left.cellY === right.cellY && left.axis === right.axis;
}

function withinSlop(state: DwellState, x: number, y: number, slop: number): boolean {
  const dx = x - state.anchorX;
  const dy = y - state.anchorY;
  return dx * dx + dy * dy <= slop * slop;
}

export interface DwellVerdict {
  /** State to carry into the next event; `undefined` means "no dwell in progress". */
  readonly state: DwellState | undefined;
  /** True only on the event where the dwell has been satisfied. */
  readonly satisfied: boolean;
}

/**
 * Advances the dwell state machine by one pointer event.
 *
 * `now` is passed in rather than read from the clock so tests can drive it.
 * A satisfied dwell keeps its state: the caller may fire the preview once, and
 * holding still afterwards must not re-fire or cancel it.
 */
export function advanceDwell(
  state: DwellState | undefined,
  hit: { readonly cell: { readonly x: number; readonly y: number }; readonly inGapX: boolean; readonly inGapY: boolean },
  point: { readonly x: number; readonly y: number },
  now: number,
  options: { readonly dwellMs?: number; readonly slopPx?: number } = {},
): DwellVerdict {
  const dwellMs = options.dwellMs ?? INSERT_DWELL_MS;
  const slopPx = options.slopPx ?? INSERT_DWELL_SLOP_PX;
  const key = dwellKeyFor(hit);

  // Leaving the gutter drops the dwell immediately: a sweep across a gutter
  // must not count as dwelling on it.
  if (!key) return { state: undefined, satisfied: false };

  if (state && sameKey(state.key, key) && withinSlop(state, point.x, point.y, slopPx)) {
    // Same gutter, pointer essentially still: keep accumulating.
    return { state, satisfied: now - state.since >= dwellMs };
  }

  // New target, or movement beyond the slop radius: restart the timer here.
  return {
    state: { key, anchorX: point.x, anchorY: point.y, since: now },
    satisfied: false,
  };
}

/** Milliseconds a fresh dwell still needs; used for the pending-insert timer. */
export function dwellRemaining(state: DwellState, now: number, dwellMs = INSERT_DWELL_MS): number {
  return Math.max(0, state.since + dwellMs - now);
}
