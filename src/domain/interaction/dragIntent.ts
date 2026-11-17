import type { GridColumns, LayoutItem, Point, Rect } from '@/src/domain/grid/model';
import { readingOrder } from '@/src/domain/grid/model';
import { layoutHeight } from '@/src/domain/grid/occupancy';
import type { LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';
import { clampColumn, type CellHit, cellWithinRect } from './dragGeometry';

/** No offset: the pointer's cell is the item's top-left, as for a 1x1 icon. */
const NO_ANCHOR: Point = { x: 0, y: 0 };

/**
 * Product baseline 6.2 splits the pointer surface into three intentions:
 * icon body -> swap, gutter/insertion line -> push, empty cell -> move.
 * The solver already owns 6.3/6.4/6.5, so this layer only picks the target
 * rect and the conflict preference; it never decides the final arrangement.
 */
export type DropIntent =
  | { readonly kind: 'move' | 'swap'; readonly target: Rect; readonly preference: 'auto' }
  | { readonly kind: 'insert'; readonly target: Rect; readonly preference: 'push-first'; readonly index: number };

export function dropIntentKindLabel(intent: DropIntent): string {
  if (intent.kind === 'insert') return '插入推挤';
  return intent.kind === 'swap' ? '交换' : '移动';
}

/**
 * @param anchor Which cell inside the dragged item the pointer grabbed. The move
 *   target is shifted back by it so the grabbed point stays under the pointer;
 *   without this, dragging a 2x2 widget by its centre placed the target one cell
 *   down and right of the thing being carried.
 *
 *   Swap and insert deliberately ignore it: a swap is "take that object's cell",
 *   and an insertion is defined by the pointer's position in the gutter, not by
 *   where inside the widget the drag started.
 */
export function resolveDropIntent(
  hit: CellHit,
  items: readonly LayoutItem[],
  dragged: LayoutItem,
  columns: GridColumns,
  anchor: Point = NO_ANCHOR,
): DropIntent {
  const size = { w: dragged.w, h: dragged.h };

  if (hit.inGapY || hit.inGapX) {
    const ordered = readingOrder(items.filter((item) => item.instanceId !== dragged.instanceId));
    const row = hit.inGapY ? hit.cell.y + 1 : hit.cell.y;
    const column = hit.inGapY ? 0 : hit.cell.x + 1;
    let index = ordered.findIndex((item) => item.y >= row && (item.y > row || item.x >= column));
    if (index === -1) index = ordered.length;
    const anchor = ordered[index];
    const target: Rect = anchor
      ? { x: clampColumn(anchor.x, size.w, columns), y: anchor.y, w: size.w, h: size.h }
      : { x: 0, y: layoutHeight(items), w: size.w, h: size.h };
    return { kind: 'insert', target, preference: 'push-first', index };
  }

  const occupant = items.find((item) => item.instanceId !== dragged.instanceId && cellWithinRect(hit.cell, item));
  if (occupant) {
    return {
      kind: 'swap',
      target: { x: clampColumn(occupant.x, size.w, columns), y: occupant.y, w: size.w, h: size.h },
      preference: 'auto',
    };
  }

  return {
    kind: 'move',
    target: {
      x: clampColumn(hit.cell.x - anchor.x, size.w, columns),
      y: Math.max(0, hit.cell.y - anchor.y),
      w: size.w,
      h: size.h,
    },
    preference: 'auto',
  };
}

export function commandForIntent(intent: DropIntent, instanceId: string, direction?: 'up' | 'down' | 'left' | 'right'): LayoutCommand {
  return {
    type: 'move',
    instanceId,
    target: intent.target,
    ...(direction ? { pointerDirection: direction } : {}),
  };
}

/**
 * A preview is only re-solved when the resolved target actually changed, so a
 * pointer wobbling inside one cell cannot flood the solver or the save queue.
 */
export function intentSignature(intent: DropIntent): string {
  return `${intent.kind}:${intent.target.x},${intent.target.y},${intent.target.w},${intent.target.h}:${intent.preference}`;
}

export function shouldResolveIntent(lastSignature: string | undefined, intent: DropIntent): boolean {
  return lastSignature !== intentSignature(intent);
}

export function preferenceForIntent(intent: DropIntent): LayoutPreference {
  return intent.preference;
}
