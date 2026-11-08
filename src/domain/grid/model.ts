export const GRID_BREAKPOINTS = [10, 8, 5] as const;
export type GridColumns = (typeof GRID_BREAKPOINTS)[number];

export interface Point { readonly x: number; readonly y: number; }
export interface Rect extends Point { readonly w: number; readonly h: number; }
export interface SizeConstraint {
  readonly presets: readonly (readonly [width: number, height: number])[];
  readonly minW: number;
  readonly minH: number;
  readonly maxW: number;
  readonly maxH: number;
}
export interface LayoutItem extends Rect {
  readonly instanceId: string;
  readonly kind: 'shortcut' | 'widget';
  readonly breakpoint: GridColumns;
  readonly locked: boolean;
  readonly order: number;
  readonly groupId?: string | undefined;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function containsRect(container: Rect, rect: Rect): boolean {
  return rect.x >= container.x && rect.y >= container.y &&
    rect.x + rect.w <= container.x + container.w && rect.y + rect.h <= container.y + container.h;
}

export function isValidLayout(items: readonly LayoutItem[], columns: GridColumns): boolean {
  const ids = new Set<string>();
  return items.every((item, index) => {
    if (ids.has(item.instanceId)) return false;
    ids.add(item.instanceId);
    const validGeometry = [item.x, item.y, item.w, item.h].every(Number.isInteger) &&
      item.x >= 0 && item.y >= 0 && item.w >= 1 && item.h >= 1 &&
      item.x + item.w <= columns && item.breakpoint === columns;
    return validGeometry && items.slice(0, index).every((previous) => !rectsOverlap(item, previous));
  });
}

export function findFirstFit(
  items: readonly LayoutItem[],
  size: Readonly<{ w: number; h: number; instanceId?: string; reference?: Point }>,
  columns: GridColumns,
): Point | undefined {
  if (!isValidLayout(items, columns) || !Number.isInteger(size.w) || !Number.isInteger(size.h) ||
      size.w < 1 || size.h < 1 || size.w > columns) return undefined;
  const maxY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const reference = size.reference;
  const candidates: Point[] = [];
  for (let y = 0; y <= maxY + 1; y += 1) {
    for (let x = 0; x <= columns - size.w; x += 1) {
      if (items.every((item) => item.instanceId === size.instanceId || !rectsOverlap({ x, y, w: size.w, h: size.h }, item))) candidates.push({ x, y });
    }
  }
  if (reference) candidates.sort((a, b) => Math.abs(a.x - reference.x) + Math.abs(a.y - reference.y) - Math.abs(b.x - reference.x) - Math.abs(b.y - reference.y) || a.y - b.y || a.x - b.x);
  return candidates[0];
}

export type LayoutConstraints = Readonly<Record<string, SizeConstraint>>;

export const SHORTCUT_SIZE: SizeConstraint = { presets: [[1, 1]], minW: 1, minH: 1, maxW: 1, maxH: 1 };

export const BUILTIN_SIZE_CONSTRAINTS: Readonly<Record<string, SizeConstraint>> = {
  'builtin.clock': { presets: [[4, 2], [5, 2], [6, 2]], minW: 4, minH: 2, maxW: 6, maxH: 2 },
  'builtin.search': { presets: [[5, 1], [6, 1]], minW: 5, minH: 1, maxW: 6, maxH: 1 },
  'builtin.calendar': { presets: [[4, 2], [4, 4]], minW: 4, minH: 2, maxW: 4, maxH: 4 },
};

export function constraintsForItem(item: LayoutItem, constraints: LayoutConstraints = BUILTIN_SIZE_CONSTRAINTS): SizeConstraint {
  return constraints[item.instanceId] ?? (item.kind === 'shortcut' ? SHORTCUT_SIZE : DEFAULT_WIDGET_SIZE);
}

export const DEFAULT_WIDGET_SIZE: SizeConstraint = { presets: [[2, 2], [4, 2], [4, 4]], minW: 2, minH: 2, maxW: 4, maxH: 4 };

export function isValidSize(item: Pick<LayoutItem, 'w' | 'h'>, constraint: SizeConstraint): boolean {
  return constraint.presets.some(([w, h]) => item.w === w && item.h === h) ||
    (item.w >= constraint.minW && item.w <= constraint.maxW && item.h >= constraint.minH && item.h <= constraint.maxH);
}

export function isValidConstrainedLayout(items: readonly LayoutItem[], columns: GridColumns, constraints: LayoutConstraints = BUILTIN_SIZE_CONSTRAINTS): boolean {
  return isValidLayout(items, columns) && items.every((item) => isValidSize(item, constraintsForItem(item, constraints)));
}

export function readingOrder(items: readonly LayoutItem[]): LayoutItem[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.order - b.order || a.instanceId.localeCompare(b.instanceId));
}
