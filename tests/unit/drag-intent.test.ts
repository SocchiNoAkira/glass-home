import { describe, expect, it } from 'vitest';
import type { LayoutItem, GridColumns } from '@/src/domain/grid/model';
import {
  commandForIntent, dropIntentKindLabel, intentSignature, preferenceForIntent, resolveDropIntent, shouldResolveIntent,
} from '@/src/domain/interaction/dragIntent';
import type { CellHit } from '@/src/domain/interaction/dragGeometry';

/**
 * Product baseline 6.2: icon body -> swap, gutter/insertion line -> push,
 * empty cell -> move. This layer only chooses the target and the preference;
 * the solver still decides the final arrangement.
 */

function item(instanceId: string, x: number, y: number, w = 1, h = 1, locked = false): LayoutItem {
  return { instanceId, kind: w > 1 ? 'widget' : 'shortcut', breakpoint: 10, x, y, w, h, locked, order: 0 };
}

const COLUMNS: GridColumns = 10;
function hit(x: number, y: number, inGapX = false, inGapY = false): CellHit {
  return { cell: { x, y }, inGapX, inGapY };
}

// github and figma are shortcuts on row 0; calendar is a 4x2 widget at y=1.
const LAYOUT = [item('github', 0, 0), item('figma', 1, 0), item('calendar', 2, 1, 4, 2)];
const DRAGGED = LAYOUT[0]!;

describe('drop intent resolution', () => {
  it('prefers swap when the pointer is over another icon body', () => {
    const intent = resolveDropIntent(hit(1, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(intent.kind).toBe('swap');
    expect(intent.preference).toBe('auto');
    expect(intent.target).toEqual({ x: 1, y: 0, w: 1, h: 1 });
  });

  it('moves into an empty cell without preferring a swap', () => {
    const intent = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(intent.kind).toBe('move');
    expect(intent.target).toEqual({ x: 5, y: 0, w: 1, h: 1 });
  });

  it('turns a vertical gutter hit into a push-first insertion', () => {
    const intent = resolveDropIntent(hit(0, 0, false, true), LAYOUT, DRAGGED, COLUMNS);
    expect(intent.kind).toBe('insert');
    expect(intent.preference).toBe('push-first');
    if (intent.kind !== 'insert') throw new Error('unreachable');
    // Inserting below row 0 lands before the next reading-order item (calendar at y=1).
    expect(intent.index).toBe(1);
    expect(intent.target).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it('keeps the dragged item out of its own insertion index', () => {
    // github is excluded from the ordered list, so index counts only the others.
    const intent = resolveDropIntent(hit(0, 0, false, true), LAYOUT, DRAGGED, COLUMNS);
    if (intent.kind !== 'insert') throw new Error('unreachable');
    expect(intent.index).toBeLessThan(LAYOUT.length - 1 + 1);
    expect(intent.index).toBeGreaterThanOrEqual(0);
  });

  it('appends to a new trailing row when nothing follows the insertion point', () => {
    const intent = resolveDropIntent(hit(0, 3, false, true), LAYOUT, DRAGGED, COLUMNS);
    if (intent.kind !== 'insert') throw new Error('unreachable');
    // layoutHeight of the full layout is 3 (calendar ends at y=3), so the anchor row is 3.
    expect(intent.target.y).toBe(3);
    expect(intent.target.x).toBe(0);
    expect(intent.index).toBe(LAYOUT.length - 1);
  });

  it('preserves the dragged widget size when resolving a target', () => {
    const widget = LAYOUT[2]!;
    const intent = resolveDropIntent(hit(7, 0), LAYOUT, widget, COLUMNS);
    expect(intent.target.w).toBe(4);
    expect(intent.target.h).toBe(2);
    // A 4-wide widget cannot start past column 6.
    const edge = resolveDropIntent(hit(9, 0), LAYOUT, widget, COLUMNS);
    expect(edge.target.x).toBe(6);
  });

  it('ignores the dragged item when looking for an occupant', () => {
    const intent = resolveDropIntent(hit(0, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(intent.kind).toBe('move');
    expect(intent.target).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('grab anchor in drop targets', () => {
  // A 2x2 widget grabbed by its bottom-right cell.
  const GRABBED = item('todo', 2, 1, 2, 2);
  const ANCHOR = { x: 1, y: 1 };

  it('places the move target one cell back along both axes', () => {
    const intent = resolveDropIntent(hit(5, 3), LAYOUT, GRABBED, COLUMNS, ANCHOR);
    expect(intent.kind).toBe('move');
    expect(intent.target).toEqual({ x: 4, y: 2, w: 2, h: 2 });
  });

  it('clamps the anchored target at the grid edge instead of going negative', () => {
    const intent = resolveDropIntent(hit(0, 0), LAYOUT, GRABBED, COLUMNS, ANCHOR);
    expect(intent.target).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('leaves swap alone: a swap takes the other object cell, wherever it was grabbed', () => {
    const intent = resolveDropIntent(hit(1, 0), LAYOUT, GRABBED, COLUMNS, ANCHOR);
    expect(intent.kind).toBe('swap');
    expect(intent.target).toEqual({ x: 1, y: 0, w: 2, h: 2 });
  });

  it('leaves insertion alone: it is defined by the pointer in the gutter', () => {
    const anchored = resolveDropIntent(hit(0, 0, false, true), LAYOUT, GRABBED, COLUMNS, ANCHOR);
    const plain = resolveDropIntent(hit(0, 0, false, true), LAYOUT, GRABBED, COLUMNS);
    expect(anchored).toEqual(plain);
  });
});

describe('intent signature de-duplication', () => {
  it('is stable for the same target and preference', () => {
    const a = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    const b = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(intentSignature(a)).toBe(intentSignature(b));
    expect(shouldResolveIntent(intentSignature(a), b)).toBe(false);
  });

  it('changes when the resolved cell changes', () => {
    const a = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    const b = resolveDropIntent(hit(6, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(shouldResolveIntent(intentSignature(a), b)).toBe(true);
  });

  it('changes when the kind changes even at the same cell', () => {
    const moveIntent = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    const insertIntent = resolveDropIntent(hit(5, 0, false, true), LAYOUT, DRAGGED, COLUMNS);
    expect(shouldResolveIntent(intentSignature(moveIntent), insertIntent)).toBe(true);
  });

  it('resolves the first intent when there is no previous signature', () => {
    const intent = resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(shouldResolveIntent(undefined, intent)).toBe(true);
  });

  it('does not de-duplicate targets that differ only in size', () => {
    const dragged = LAYOUT[2]!;
    const small = resolveDropIntent(hit(1, 0), LAYOUT, item('x', 0, 0, 2, 2), COLUMNS);
    const big = resolveDropIntent(hit(1, 0), LAYOUT, dragged, COLUMNS);
    expect(intentSignature(small)).not.toBe(intentSignature(big));
  });
});

describe('intent to command mapping', () => {
  it('always produces a move command, never a solver-side insert', () => {
    const insert = resolveDropIntent(hit(0, 0, false, true), LAYOUT, DRAGGED, COLUMNS);
    const command = commandForIntent(insert, 'github');
    expect(command.type).toBe('move');
    // `commandForIntent` is typed as the whole LayoutCommand union, so narrow
    // to the move variant before reading its fields.
    if (command.type !== 'move') throw new Error('expected a move command');
    expect(command.instanceId).toBe('github');
    expect(command.target).toEqual(insert.target);
  });

  it('carries the pointer direction when one is known', () => {
    const intent = resolveDropIntent(hit(2, 0), LAYOUT, DRAGGED, COLUMNS);
    expect(commandForIntent(intent, 'github', 'right')).toMatchObject({ pointerDirection: 'right' });
    expect(commandForIntent(intent, 'github')).not.toHaveProperty('pointerDirection');
  });

  it('maps each intent kind to its preference and label', () => {
    expect(preferenceForIntent(resolveDropIntent(hit(1, 0), LAYOUT, DRAGGED, COLUMNS))).toBe('auto');
    expect(preferenceForIntent(resolveDropIntent(hit(0, 0, false, true), LAYOUT, DRAGGED, COLUMNS))).toBe('push-first');
    expect(dropIntentKindLabel(resolveDropIntent(hit(5, 0), LAYOUT, DRAGGED, COLUMNS))).toBe('移动');
    expect(dropIntentKindLabel(resolveDropIntent(hit(1, 0), LAYOUT, DRAGGED, COLUMNS))).toBe('交换');
    expect(dropIntentKindLabel(resolveDropIntent(hit(0, 0, false, true), LAYOUT, DRAGGED, COLUMNS))).toBe('插入推挤');
  });
});
