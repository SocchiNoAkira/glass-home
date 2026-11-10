import type { GridColumns, LayoutItem, Rect } from './model';

export class OccupancyGrid {
  readonly columns: GridColumns;
  readonly rows: number;
  private readonly cells: (string | undefined)[];

  constructor(columns: GridColumns, rows = 1) {
    this.columns = columns;
    this.rows = Math.max(1, rows);
    this.cells = new Array<string | undefined>(this.rows * columns);
  }

  static fromLayout(items: readonly LayoutItem[], columns: GridColumns): OccupancyGrid {
    const rows = items.reduce((height, item) => Math.max(height, item.y + item.h), 1);
    const grid = new OccupancyGrid(columns, rows);
    for (const item of items) grid.place(item);
    return grid;
  }

  /**
 * A copy of this grid.
 *
 * The array must be *replaced*, not appended to: the constructor already
 * allocated `rows * columns` slots, so `push`ing the source cells doubled the
 * length and left the real occupancy in the second half — `at(x, y)` indexes the
 * first half and reads `undefined` for every cell. Assigning in place keeps the
 * length and the index arithmetic intact.
 */
  clone(): OccupancyGrid {
    const grid = new OccupancyGrid(this.columns, this.rows);
    grid.cells.splice(0, grid.cells.length, ...this.cells);
    return grid;
  }

  canPlace(rect: Rect, exceptId?: string): boolean {
    if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.w) || !Number.isInteger(rect.h) ||
      rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1 || rect.x + rect.w > this.columns) return false;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const occupant = this.at(x, y);
        if (occupant !== undefined && occupant !== exceptId) return false;
      }
    }
    return true;
  }

  place(item: LayoutItem): void {
    for (let y = item.y; y < item.y + item.h; y += 1) {
      for (let x = item.x; x < item.x + item.w; x += 1) this.cells[y * this.columns + x] = item.instanceId;
    }
  }

  remove(item: LayoutItem): void {
    for (let y = item.y; y < item.y + item.h; y += 1) {
      for (let x = item.x; x < item.x + item.w; x += 1) {
        const index = y * this.columns + x;
        if (this.cells[index] === item.instanceId) this.cells[index] = undefined;
      }
    }
  }

  at(x: number, y: number): string | undefined {
    if (x < 0 || y < 0 || x >= this.columns) return undefined;
    return this.cells[y * this.columns + x];
  }

  signature(): string {
    let lastOccupied = -1;
    for (let index = this.cells.length - 1; index >= 0; index -= 1) {
      if (this.cells[index] !== undefined) { lastOccupied = index; break; }
    }
    return this.cells.slice(0, lastOccupied + 1).map((id) => id ?? '.').join('|');
  }
}

export function layoutSignature(items: readonly LayoutItem[]): string {
  return [...items].sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((item) => `${item.instanceId}:${item.x},${item.y},${item.w},${item.h},${Number(item.locked)}`).join('|');
}

export function layoutHeight(items: readonly LayoutItem[]): number {
  return items.reduce((height, item) => Math.max(height, item.y + item.h), 0);
}

export function collidingItems(items: readonly LayoutItem[], target: Rect, exceptIds: ReadonlySet<string> = new Set()): LayoutItem[] {
  return items.filter((item) => !exceptIds.has(item.instanceId) &&
    item.x < target.x + target.w && target.x < item.x + item.w && item.y < target.y + target.h && target.y < item.y + item.h);
}
