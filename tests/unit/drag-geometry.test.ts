import { describe, expect, it } from 'vitest';
import {
  cellStrideX, cellStrideY, clampColumn, columnOffset, grabAnchor, hitCell, rowOffset, type GridMetrics,
} from '@/src/domain/interaction/dragGeometry';

/**
 * Contract test for the hit-test layer. These numbers are the whole reason the
 * drag feels predictable: pads and gaps are counted once, at drag start, and
 * every later hit is integer arithmetic on top of the same measurement.
 */

// 10 columns, 80px tracks, 10px column gap, 20px rows, 12px row gap, 16/24 padding.
const METRICS: GridMetrics = {
  columns: 10,
  cellWidth: 80,
  rowHeight: 20,
  gapX: 10,
  gapY: 12,
  padLeft: 16,
  padTop: 24,
};

function point(x: number, y: number) { return { x, y }; }

describe('grid metrics arithmetic', () => {
  it('uses one stride per track plus one gap', () => {
    expect(cellStrideX(METRICS)).toBe(90);
    expect(cellStrideY(METRICS)).toBe(32);
  });

  it('derives offsets from the padding origin, not the border box', () => {
    expect(columnOffset(METRICS, 0)).toBe(16);
    expect(columnOffset(METRICS, 3)).toBe(16 + 3 * 90);
    expect(rowOffset(METRICS, 0)).toBe(24);
    expect(rowOffset(METRICS, 2)).toBe(24 + 2 * 32);
  });
});

describe('hit cell resolution', () => {
  it('maps a point inside a cell to that cell', () => {
    expect(hitCell(point(16, 24), METRICS)).toEqual({ cell: { x: 0, y: 0 }, inGapX: false, inGapY: false });
    // Last pixel of the first track is still inside the cell.
    expect(hitCell(point(16 + 79, 24), METRICS).inGapX).toBe(false);
  });

  it('reports the horizontal gutter so the caller can offer an insertion', () => {
    expect(hitCell(point(16 + 80, 24), METRICS)).toEqual({ cell: { x: 0, y: 0 }, inGapX: true, inGapY: false });
    expect(hitCell(point(16 + 89, 24), METRICS).inGapX).toBe(true);
    // The first pixel of the next track is a normal cell again.
    expect(hitCell(point(16 + 90, 24), METRICS)).toEqual({ cell: { x: 1, y: 0 }, inGapX: false, inGapY: false });
  });

  it('reports the vertical gutter independently of the horizontal one', () => {
    expect(hitCell(point(16 + 5, 24 + 20), METRICS)).toEqual({ cell: { x: 0, y: 0 }, inGapX: false, inGapY: true });
    expect(hitCell(point(16 + 5, 24 + 31), METRICS).inGapY).toBe(true);
  });

  it('flags both gutters at the crossing point', () => {
    expect(hitCell(point(16 + 85, 24 + 25), METRICS)).toEqual({ cell: { x: 0, y: 0 }, inGapX: true, inGapY: true });
  });

  it('clamps the column at the trailing edge and never returns a negative row', () => {
    // Point beyond the last track clamps into the final column.
    expect(hitCell(point(16 + 9 * 90 + 200, 24), METRICS).cell.x).toBe(9);
    // Pointer above the grid starts still belongs to row 0 rather than -1.
    expect(hitCell(point(16, 10), METRICS).cell.y).toBe(0);
    expect(hitCell(point(-50, -50), METRICS).cell).toEqual({ x: 0, y: 0 });
  });
});

describe('grab anchor inside the dragged object', () => {
  // 2x2 widget whose top-left cell is (2,1); see METRICS for the pixel layout.
  const WIDGET = { x: 2, y: 1, w: 2, h: 2 };
  const left = 16 + 2 * 90;
  const top = 24 + 1 * 32;

  it('reports the cell the pointer pressed, not the object corner', () => {
    expect(grabAnchor(point(left + 5, top + 5), WIDGET, METRICS)).toEqual({ x: 0, y: 0 });
    expect(grabAnchor(point(left + 95, top + 5), WIDGET, METRICS)).toEqual({ x: 1, y: 0 });
    expect(grabAnchor(point(left + 5, top + 35), WIDGET, METRICS)).toEqual({ x: 0, y: 1 });
    expect(grabAnchor(point(left + 100, top + 40), WIDGET, METRICS)).toEqual({ x: 1, y: 1 });
  });

  it('clamps to the object own span, so a press on its rim cannot offset it', () => {
    expect(grabAnchor(point(left - 500, top - 500), WIDGET, METRICS)).toEqual({ x: 0, y: 0 });
    expect(grabAnchor(point(left + 5000, top + 5000), WIDGET, METRICS)).toEqual({ x: 1, y: 1 });
  });

  it('is always the origin for a 1x1 icon', () => {
    expect(grabAnchor(point(16 + 40, 24 + 10), { x: 0, y: 0, w: 1, h: 1 }, METRICS)).toEqual({ x: 0, y: 0 });
  });
});

describe('column clamping for the dragged width', () => {
  it('keeps a rect fully inside the column count', () => {
    expect(clampColumn(0, 1, 10)).toBe(0);
    expect(clampColumn(9, 1, 10)).toBe(9);
    expect(clampColumn(12, 1, 10)).toBe(9);
    // A 4-wide widget can start at column 6 at most.
    expect(clampColumn(7, 4, 10)).toBe(6);
    expect(clampColumn(-3, 4, 10)).toBe(0);
  });

  it('degrades to zero instead of going negative when the item is wider than the grid', () => {
    expect(clampColumn(2, 12, 10)).toBe(0);
  });
});
