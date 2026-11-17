import type { CSSProperties } from 'react';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';

/** Thickness of one reference line. */
const SEAM = 1;
const LINE = '#ffffff24';
const CLEAR = '#ffffff00';

/**
 * CSS length with a fixed precision: track sizes are fractional (a 10-column
 * grid inside 1032px has 102.4px cells), and `102.4 + 1` serialises as
 * `103.40000000000001` without this.
 */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/**
 * Reference texture shown while a drag is in flight (and for the whole edit
 * session): exactly one square per grid cell, drawn from the measured tracks.
 *
 * The previous version was a fixed 24px CSS pattern. Rows are 92px, 82px or
 * 76px depending on the breakpoint while columns are fractional, so that pattern
 * had nothing to do with the cells a shortcut can actually be dropped into — the
 * eye had no way to tell where a cell ended and the gutter began.
 *
 * Two details make each square exactly one cell:
 * - `cellWidth` comes from the same `measureGridMetrics` call the hit tester
 *   uses, so the texture and the drop targets cannot disagree;
 * - each gradient repeats with the *stride* (cell + gutter) as its period and
 *   draws both cell edges inside that period. Tiling by cell width instead
 *   would accumulate one gutter per column, which is the drift this avoids.
 *
 * `background-origin: content-box` starts the pattern at the first column: with
 * the default `padding-box` the whole texture would be shifted by the grid's
 * padding (non-zero in edit mode on narrow screens).
 */
export function gridCellTexture(metrics: GridMetrics): CSSProperties {
  const { cellWidth, rowHeight, gapX, gapY } = metrics;
  const columns = `repeating-linear-gradient(to right,`
    + ` ${LINE} ${px(0)} ${px(SEAM)},`
    + ` ${CLEAR} ${px(SEAM)} ${px(cellWidth)},`
    + ` ${LINE} ${px(cellWidth)} ${px(cellWidth + SEAM)},`
    + ` ${CLEAR} ${px(cellWidth + SEAM)} ${px(cellWidth + gapX)})`;
  const rows = `repeating-linear-gradient(to bottom,`
    + ` ${LINE} ${px(0)} ${px(SEAM)},`
    + ` ${CLEAR} ${px(SEAM)} ${px(rowHeight)},`
    + ` ${LINE} ${px(rowHeight)} ${px(rowHeight + SEAM)},`
    + ` ${CLEAR} ${px(rowHeight + SEAM)} ${px(rowHeight + gapY)})`;

  return {
    backgroundImage: `${columns}, ${rows}`,
    backgroundOrigin: 'content-box',
  };
}
