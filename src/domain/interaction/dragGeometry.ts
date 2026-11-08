import type { GridColumns, Point } from '@/src/domain/grid/model';

/**
 * Stage 2B geometry is intentionally layout-independent: the caller measures
 * the rendered grid once (see features/grid/gridMetrics.ts) and every hit test
 * afterwards is pure integer arithmetic. That keeps drag targets derived from
 * the committed layout instead of from a preview that is already mid-animation.
 */
export interface GridMetrics {
  readonly columns: GridColumns;
  readonly cellWidth: number;
  readonly rowHeight: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly padLeft: number;
  readonly padTop: number;
}

export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

export interface CellHit {
  readonly cell: Point;
  /** Pointer is inside the horizontal gutter to the right of `cell`. */
  readonly inGapX: boolean;
  /** Pointer is inside the vertical gutter below `cell`. */
  readonly inGapY: boolean;
}

export function cellStrideX(metrics: GridMetrics): number {
  return metrics.cellWidth + metrics.gapX;
}

export function cellStrideY(metrics: GridMetrics): number {
  return metrics.rowHeight + metrics.gapY;
}

/** Horizontal distance from the grid content origin to the start of a column. */
export function columnOffset(metrics: GridMetrics, column: number): number {
  return metrics.padLeft + column * cellStrideX(metrics);
}

/** Vertical distance from the grid content origin to the start of a row. */
export function rowOffset(metrics: GridMetrics, row: number): number {
  return metrics.padTop + row * cellStrideY(metrics);
}

export function hitCell(point: LocalPoint, metrics: GridMetrics): CellHit {
  const strideX = cellStrideX(metrics);
  const strideY = cellStrideY(metrics);
  const rawX = point.x - metrics.padLeft;
  const rawY = point.y - metrics.padTop;
  const columnIndex = strideX > 0 ? Math.floor(rawX / strideX) : 0;
  const rowIndex = strideY > 0 ? Math.floor(rawY / strideY) : 0;
  const offsetX = rawX - columnIndex * strideX;
  const offsetY = rawY - rowIndex * strideY;
  const inGapX = strideX > 0 && offsetX >= metrics.cellWidth && offsetX < strideX;
  const inGapY = strideY > 0 && offsetY >= metrics.rowHeight && offsetY < strideY;
  return {
    cell: {
      x: Math.min(Math.max(columnIndex, 0), metrics.columns - 1),
      y: Math.max(rowIndex, 0),
    },
    inGapX,
    inGapY,
  };
}

export function cellWithinRect(cell: Point, rect: Readonly<Point & { readonly w: number; readonly h: number }>): boolean {
  return cell.x >= rect.x && cell.x < rect.x + rect.w && cell.y >= rect.y && cell.y < rect.y + rect.h;
}

export function clampColumn(x: number, width: number, columns: GridColumns): number {
  return Math.min(Math.max(x, 0), Math.max(0, columns - width));
}
