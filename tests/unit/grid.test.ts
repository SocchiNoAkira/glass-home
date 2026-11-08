import { describe, expect, it } from 'vitest';
import { findFirstFit, isValidLayout, rectsOverlap, type LayoutItem } from '@/src/domain/grid/model';

function item(instanceId: string, x: number, y: number, w = 1, h = 1): LayoutItem {
  return { instanceId, kind: 'shortcut', breakpoint: 10, x, y, w, h, locked: false, order: 0 };
}

describe('grid primitives', () => {
  it('treats touching edges as non-overlapping', () => {
    expect(rectsOverlap(item('a', 0, 0), item('b', 1, 0))).toBe(false);
    expect(rectsOverlap(item('a', 0, 0, 2, 2), item('b', 1, 1, 2, 2))).toBe(true);
    expect(rectsOverlap(item('a', 0, 0, 2, 2), item('b', 0, 2, 2, 2))).toBe(false);
  });

  it('accepts a valid mixed-size layout and keeps each ID unique', () => {
    expect(isValidLayout([item('clock', 0, 0, 4, 2), item('shortcut', 4, 0)], 10)).toBe(true);
    expect(isValidLayout([item('same', 0, 0), item('same', 1, 0)], 10)).toBe(false);
  });

  it('rejects overflow, overlap, non-integers and breakpoint mismatch', () => {
    expect(isValidLayout([item('a', 0, 0, 4, 2), item('b', 3, 1)], 10)).toBe(false);
    expect(isValidLayout([item('a', 7, 0, 4, 2)], 10)).toBe(false);
    expect(isValidLayout([item('a', 0.5, 0)], 10)).toBe(false);
    expect(isValidLayout([item('a', 0, 0)], 5)).toBe(false);
    expect(isValidLayout([item('a', 0, -1)], 10)).toBe(false);
  });

  it('finds the first full gap in reading order', () => {
    const occupied = Array.from({ length: 10 }, (_, x) => item(`top-${x}`, x, 0));
    occupied.push(item('left', 0, 1, 2, 2));
    expect(findFirstFit(occupied, { w: 2, h: 2 }, 10)).toEqual({ x: 2, y: 1 });
  });

  it('adds a row when the current page is full', () => {
    const occupied = Array.from({ length: 10 }, (_, x) => item(`top-${x}`, x, 0));
    expect(findFirstFit(occupied, { w: 1, h: 1 }, 10)).toEqual({ x: 0, y: 1 });
  });

  it('never shrinks an item to force placement', () => {
    expect(findFirstFit([], { w: 11, h: 1 }, 10)).toBeUndefined();
    expect(findFirstFit([item('a', 0, 0), item('a', 0, 0)], { w: 1, h: 1 }, 10)).toBeUndefined();
  });
});
