import type { Direction, LayoutCommand } from '@/src/domain/grid/solver';
import type { GridColumns, LayoutItem, Rect } from '@/src/domain/grid/model';
import { constraintsForItem } from '@/src/domain/grid/model';
import { clampColumn } from './dragGeometry';

export type KeyboardLayoutMode = 'move' | 'resize';

export function arrowDelta(direction: Direction): { readonly dx: number; readonly dy: number } {
  switch (direction) {
    case 'left': return { dx: -1, dy: 0 };
    case 'right': return { dx: 1, dy: 0 };
    case 'up': return { dx: 0, dy: -1 };
    case 'down': return { dx: 0, dy: 1 };
  }
}

/**
 * Arrow keys move by one cell; Alt+Arrow resizes by one cell inside the
 * component's readable-size constraint. Locked items and already-edge targets
 * return undefined so the caller can leave focus and history untouched.
 */
export function keyboardTarget(
  item: LayoutItem,
  direction: Direction,
  columns: GridColumns,
  mode: KeyboardLayoutMode,
): Rect | undefined {
  if (item.locked) return undefined;
  const delta = arrowDelta(direction);

  if (mode === 'move') {
    const x = clampColumn(item.x + delta.dx, item.w, columns);
    const y = Math.max(item.y + delta.dy, 0);
    if (x === item.x && y === item.y) return undefined;
    return { x, y, w: item.w, h: item.h };
  }

  const constraint = constraintsForItem(item);
  const w = mode === 'resize' ? Math.min(Math.max(item.w + delta.dx, constraint.minW), constraint.maxW) : item.w;
  const h = mode === 'resize' ? Math.min(Math.max(item.h + delta.dy, constraint.minH), constraint.maxH) : item.h;
  const x = clampColumn(item.x, w, columns);
  if (w === item.w && h === item.h) return undefined;
  return { x, y: item.y, w, h };
}

export function keyboardCommand(
  item: LayoutItem,
  direction: Direction,
  columns: GridColumns,
  mode: KeyboardLayoutMode,
): LayoutCommand | undefined {
  const target = keyboardTarget(item, direction, columns, mode);
  if (!target) return undefined;
  return { type: mode, instanceId: item.instanceId, target, pointerDirection: direction };
}
