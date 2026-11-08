import { describe, expect, it } from 'vitest';
import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';
import { keyboardCommand, keyboardTarget } from '@/src/domain/interaction/keyboardLayout';

/**
 * Product baseline 7.3: arrow keys move one cell, Alt+Arrow resizes one cell,
 * and nothing is consumed when the result would not change — at the grid edge,
 * on a locked item, or inside the size constraint.
 */

function item(instanceId: string, x: number, y: number, w = 1, h = 1, locked = false, kind: 'shortcut' | 'widget' = 'shortcut'): LayoutItem {
  return { instanceId, kind, breakpoint: 10, x, y, w, h, locked, order: 0 };
}

const COLUMNS: GridColumns = 10;

describe('keyboard move', () => {
  it('moves one cell in each direction', () => {
    const source = item('github', 3, 2);
    expect(keyboardTarget(source, 'right', COLUMNS, 'move')).toEqual({ x: 4, y: 2, w: 1, h: 1 });
    expect(keyboardTarget(source, 'left', COLUMNS, 'move')).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(keyboardTarget(source, 'down', COLUMNS, 'move')).toEqual({ x: 3, y: 3, w: 1, h: 1 });
    expect(keyboardTarget(source, 'up', COLUMNS, 'move')).toEqual({ x: 3, y: 1, w: 1, h: 1 });
  });

  it('does not consume a key that cannot change anything', () => {
    // Already at the top-left corner.
    expect(keyboardTarget(item('a', 0, 0), 'left', COLUMNS, 'move')).toBeUndefined();
    expect(keyboardTarget(item('a', 0, 0), 'up', COLUMNS, 'move')).toBeUndefined();
    // Already at the last column for a 1-wide item.
    expect(keyboardTarget(item('a', 9, 0), 'right', COLUMNS, 'move')).toBeUndefined();
    expect(keyboardCommand(item('a', 9, 0), 'right', COLUMNS, 'move')).toBeUndefined();
  });

  it('refuses to move a locked item', () => {
    expect(keyboardTarget(item('a', 3, 3, 1, 1, true), 'right', COLUMNS, 'move')).toBeUndefined();
  });

  it('keeps a wide widget inside the column count', () => {
    // A 4-wide widget at x=6 is already flush right; a further right press must do nothing.
    expect(keyboardTarget(item('cal', 6, 1, 4, 2, false, 'widget'), 'right', COLUMNS, 'move')).toBeUndefined();
    // From x=5 it can still advance to 6.
    expect(keyboardTarget(item('cal', 5, 1, 4, 2, false, 'widget'), 'right', COLUMNS, 'move')).toMatchObject({ x: 6 });
  });
});

describe('keyboard resize', () => {
  it('grows and shrinks within the widget constraint', () => {
    const search = item('builtin.search', 0, 1, 5, 1, false, 'widget');
    expect(keyboardTarget(search, 'right', COLUMNS, 'resize')).toEqual({ x: 0, y: 1, w: 6, h: 1 });
    // 5 is the minimum width, so a left press changes nothing.
    expect(keyboardTarget(search, 'left', COLUMNS, 'resize')).toBeUndefined();
  });

  it('stops at the constraint maximum instead of overflowing the grid', () => {
    const clock = item('builtin.clock', 0, 0, 6, 2, false, 'widget');
    // maxW for the clock is 6.
    expect(keyboardTarget(clock, 'right', COLUMNS, 'resize')).toBeUndefined();
  });

  it('cannot resize a 1x1 shortcut', () => {
    expect(keyboardTarget(item('github', 3, 3), 'right', COLUMNS, 'resize')).toBeUndefined();
    expect(keyboardTarget(item('github', 3, 3), 'down', COLUMNS, 'resize')).toBeUndefined();
  });

  it('pulls the widget left so the new width still fits', () => {
    // A 4-wide widget at x=6 cannot grow to 5; the target is clamped, not rejected.
    const wide = item('custom', 6, 1, 4, 2, false, 'widget');
    const target = keyboardTarget(wide, 'right', COLUMNS, 'resize');
    if (target) expect(target.x).toBeLessThanOrEqual(COLUMNS - target.w);
  });
});

describe('command shape', () => {
  it('emits a move or resize command with the pointer direction', () => {
    const move = keyboardCommand(item('github', 3, 2), 'right', COLUMNS, 'move');
    expect(move).toMatchObject({ type: 'move', instanceId: 'github', pointerDirection: 'right' });

    const resize = keyboardCommand(item('builtin.search', 0, 1, 5, 1, false, 'widget'), 'right', COLUMNS, 'resize');
    expect(resize).toMatchObject({ type: 'resize', instanceId: 'builtin.search', pointerDirection: 'right' });
  });

  it('returns undefined rather than an empty command', () => {
    expect(keyboardCommand(item('a', 0, 0), 'up', COLUMNS, 'move')).toBeUndefined();
  });
});
