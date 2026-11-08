import type { GridColumns } from '@/src/domain/grid/model';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';

/**
 * Reads the rendered CSS grid once and converts it into the layout-independent
 * metrics that `dragGeometry` expects. The measurement happens at drag start,
 * not per pointer move, so a live preview that is already re-rendering cannot
 * shift the hit-test origin underneath the pointer.
 *
 * The returned metrics describe the padding box:
 * - `padLeft`/`padTop` are the grid's own padding, since the grid reserves that
 *   space for the editing outline;
 * - `cellWidth`/`rowHeight` are the usable track sizes;
 * - `gapX`/`gapY` are the gutters used for insertion-line detection.
 *
 * Returns `undefined` when the grid is not measurable yet (hidden, zero width,
 * no computed row height), so callers can decline to start a drag instead of
 * guessing coordinates.
 */
export function measureGridMetrics(grid: HTMLElement, columns: GridColumns): GridMetrics | undefined {
  const style = window.getComputedStyle(grid);
  const padLeft = parseCssLength(style.paddingLeft);
  const padRight = parseCssLength(style.paddingRight);
  const padTop = parseCssLength(style.paddingTop);
  const gapX = parseCssLength(style.columnGap);
  const gapY = parseCssLength(style.rowGap);
  const rowHeight = parseCssLength(style.gridAutoRows);

  // `clientWidth` covers the padding box and excludes the border, so the track
  // area is what remains after both paddings are removed.
  const trackWidth = grid.clientWidth - padLeft - padRight;
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return undefined;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return undefined;

  const cellWidth = (trackWidth - gapX * (columns - 1)) / columns;
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return undefined;

  return { columns, cellWidth, rowHeight, gapX, gapY, padLeft, padTop };
}

/** Distance in CSS pixels from a pointer event to the grid's padding-box origin. */
export function localPointFromEvent(grid: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = grid.getBoundingClientRect();
  const borderLeft = parseCssLength(window.getComputedStyle(grid).borderLeftWidth);
  const borderTop = parseCssLength(window.getComputedStyle(grid).borderTopWidth);
  return { x: clientX - rect.left - borderLeft, y: clientY - rect.top - borderTop };
}

function parseCssLength(value: string): number {
  // `normal` (row-gap default in some engines), `auto` and empty strings must
  // read as 0 rather than NaN, otherwise every hit test would be unusable.
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
