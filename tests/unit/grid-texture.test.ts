import { describe, expect, it } from 'vitest';
import type { CSSProperties } from 'react';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';
import { gridCellTexture } from '@/src/features/grid/gridTexture';

/**
 * The drag texture is the only visual statement about where a cell begins and
 * ends, so its geometry is asserted here rather than left to "looks right".
 *
 * Regression this guards: the texture used to be a fixed 24px CSS pattern,
 * which drew squares that no cell could ever match (fractional columns, 92px
 * rows). The numbers below are the real breakpoint values: 10 columns of
 * 102.4px with 14px gutters, 92px rows with 18px gutters.
 */

const WIDE: GridMetrics = {
  columns: 10,
  cellWidth: 102.4,
  rowHeight: 92,
  gapX: 14,
  gapY: 18,
  padLeft: 0,
  padTop: 0,
};

/** All `px` positions in one gradient, in serialisation order. */
function stops(gradient: string): number[] {
  return [...gradient.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
}

function edges(gradient: string): number[] {
  return [...new Set(stops(gradient))].sort((a, b) => a - b);
}

function layers(style: CSSProperties): [string, string] {
  const [horizontal, vertical] = String(style.backgroundImage).split(/,\s+(?=repeating-linear-gradient)/);
  if (!horizontal || !vertical) throw new Error('expected one gradient per axis');
  return [horizontal, vertical];
}

describe('cell texture geometry', () => {
  it('draws a square per cell: column edges at 0 and at the cell width', () => {
    const [horizontal, vertical] = layers(gridCellTexture(WIDE));
    // 0 / 1 is the left edge's pixel; 102.4 / 103.4 the right edge's; the period
    // closes one gutter later, so the pattern repeats once per stride.
    expect(edges(horizontal)).toEqual([0, 1, 102.4, 103.4, 116.4]);
    expect(edges(vertical)).toEqual([0, 1, 92, 93, 110]);
  });

  it('leaves the gutter empty instead of swallowing it into a wider square', () => {
    const [horizontal, vertical] = layers(gridCellTexture(WIDE));
    const column = edges(horizontal);
    const row = edges(vertical);
    // The gap between one cell's right edge and the next cell's left edge is the
    // real gutter minus the two 1px lines.
    expect(column.at(-1)! - column.at(-2)!).toBe(WIDE.gapX - 1);
    expect(row.at(-1)! - row.at(-2)!).toBe(WIDE.gapY - 1);
  });

  it('follows the narrow breakpoint tracks without being re-tuned', () => {
    const [horizontal, vertical] = layers(gridCellTexture({
      columns: 8, cellWidth: 74.5, rowHeight: 82, gapX: 10, gapY: 16, padLeft: 4, padTop: 14,
    }));
    expect(edges(horizontal)).toEqual([0, 1, 74.5, 75.5, 84.5]);
    expect(edges(vertical)).toEqual([0, 1, 82, 83, 98]);
  });

  it('starts at the first column, not at the padding edge', () => {
    // With `padding-box` (the default) the whole texture would be shifted by the
    // grid's padding, which is non-zero while editing on narrow screens.
    expect(gridCellTexture(WIDE).backgroundOrigin).toBe('content-box');
  });
});
