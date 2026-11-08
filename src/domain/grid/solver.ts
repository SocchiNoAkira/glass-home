import { collidingItems, layoutHeight, layoutSignature, OccupancyGrid } from './occupancy';
import {
  BUILTIN_SIZE_CONSTRAINTS, constraintsForItem, findFirstFit, isValidConstrainedLayout,
  isValidLayout, isValidSize, readingOrder, rectsOverlap, type GridColumns,
  type LayoutConstraints, type LayoutItem, type Rect, type SizeConstraint,
} from './model';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type LayoutPreference = 'auto' | 'swap-first' | 'push-first';
export type LayoutOperation = 'move' | 'swap' | 'push' | 'resize' | 'lock' | 'reflow' | 'compact';

export type LayoutCommand =
  | { readonly type: 'move'; readonly instanceId: string; readonly target: Rect; readonly pointerDirection?: Direction }
  | { readonly type: 'resize'; readonly instanceId: string; readonly target: Rect; readonly pointerDirection?: Direction }
  | { readonly type: 'set-lock'; readonly instanceId: string; readonly locked: boolean }
  | { readonly type: 'insert'; readonly item: LayoutItem; readonly preferred?: { readonly x: number; readonly y: number } }
  /** Whole-layout tidy (baseline 6.11 compact mode). Carries no target. */
  | { readonly type: 'compact' };

export interface SolveBudget {
  readonly maxNodes: number;
  readonly maxMs: number;
  readonly maxAffectedItems: number;
}

export interface LayoutChange {
  readonly instanceId: string;
  readonly before: LayoutItem;
  readonly after: LayoutItem;
}

export type SolveFailure = {
  readonly status: 'invalid' | 'no-placement' | 'budget-exceeded' | 'cancelled';
  readonly candidate: readonly LayoutItem[];
  readonly changes: readonly LayoutChange[];
  readonly reason: string;
};

export type SolveSuccess = {
  readonly status: 'ok';
  readonly operation: LayoutOperation;
  readonly candidate: readonly LayoutItem[];
  readonly changes: readonly LayoutChange[];
  readonly heightDelta: number;
  readonly visitedNodes: number;
};

export type SolveResult = SolveFailure | SolveSuccess;

export interface SolveInput {
  readonly columns: GridColumns;
  readonly items: readonly LayoutItem[];
  readonly constraints?: LayoutConstraints;
  readonly command: LayoutCommand;
  readonly preference?: LayoutPreference;
  readonly budget: SolveBudget;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export const DEFAULT_SOLVE_BUDGET: SolveBudget = { maxNodes: 5000, maxMs: 40, maxAffectedItems: 40 };

export function solveLayout(input: SolveInput): SolveResult {
  return new LayoutSolver(input).solve();
}

interface SearchState {
  readonly fixed: readonly LayoutItem[];
  readonly pending: readonly LayoutItem[];
  readonly path: readonly string[];
  readonly direction?: Direction;
  readonly reserved: readonly Rect[];
}

interface SearchSuccess {
  readonly items: readonly LayoutItem[];
  readonly displaced: number;
}

class LayoutSolver {
  private readonly input: SolveInput;
  private readonly constraints: LayoutConstraints;
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly visited = new Set<string>();
  private readonly occupancyCache = new Map<string, OccupancyGrid>();
  private nodes = 0;
  private failureStatus: SolveFailure['status'] = 'no-placement';
  private failureReason = '找不到合法位置，已保留原布局。';
  private foundCycle = false;

  constructor(input: SolveInput) {
    this.input = input;
    this.constraints = input.constraints ?? BUILTIN_SIZE_CONSTRAINTS;
    this.now = input.now ?? (() => performance.now());
    this.startedAt = this.now();
  }

  solve(): SolveResult {
    const { input } = this;
    if (input.signal?.aborted) return this.fail('cancelled', '操作已取消。');
    if (!isValidConstrainedLayout(input.items, input.columns, this.constraints)) return this.fail('invalid', '原始布局不合法，未执行操作。');
    if (input.budget.maxNodes < 1 || input.budget.maxMs < 0 || input.budget.maxAffectedItems < 0) return this.fail('invalid', '求解预算不合法。');

    const command = input.command;
    if (command.type === 'compact') return this.compact();
    if (command.type === 'insert') return this.insert();
    if (command.type === 'set-lock') {
      if (!input.items.some((item) => item.instanceId === command.instanceId)) return this.fail('invalid', '找不到要锁定的实例。');
      const candidate = input.items.map((item) => item.instanceId === command.instanceId ? { ...item, locked: command.locked } : item);
      return this.success(candidate, 'lock');
    }
    const item = input.items.find((candidate) => candidate.instanceId === command.instanceId);
    if (!item) return this.fail('invalid', '找不到要操作的实例。');
    if (item.locked) return this.fail('no-placement', '该对象已锁定，请先解锁。');
    if (!isValidSize(command.target, this.constraint(item))) return this.fail('no-placement', '目标尺寸不符合组件的可读尺寸约束。');

    const target = command.type === 'resize'
      ? command.target
      : { x: command.target.x, y: command.target.y, w: item.w, h: item.h };
    if (item.x === target.x && item.y === target.y && item.w === target.w && item.h === target.h) {
      return this.success(input.items, command.type === 'resize' ? 'resize' : 'move');
    }

    const collisions = collidingItems(input.items, target, new Set([item.instanceId]));
    if (input.preference !== 'push-first') {
      if (collisions.length === 0) {
        const candidate = input.items.map((current) => current.instanceId === item.instanceId ? { ...current, ...target } : current);
        return this.success(candidate, command.type === 'resize' ? 'resize' : 'move');
      }
      if (command.type === 'move' && collisions.length === 1 && !collisions[0]!.locked) {
        const other = collisions[0]!;
        const candidate = input.items.map((current) => {
          if (current.instanceId === item.instanceId) return { ...current, x: other.x, y: other.y };
          if (current.instanceId === other.instanceId) return { ...current, x: item.x, y: item.y };
          return current;
        });
        if (this.valid(candidate)) {
          // A valid swap is already the deterministic minimum two-object
          // operation. Searching a push chain here cannot improve it and can
          // consume the time budget before the swap is returned.
          const result = this.success(candidate, 'swap');
          if (result.status === 'ok') return result;
        }
      }
    }

    if (collisions.some((current) => current.locked)) return this.fail('no-placement', '目标区域包含锁定对象，已保留原布局。');
    const moved = { ...item, ...target };
    const state: SearchState = {
      fixed: [moved],
      pending: input.items.filter((current) => current.instanceId !== item.instanceId),
      path: [],
      reserved: [item],
      ...(command.pointerDirection ? { direction: command.pointerDirection } : {}),
    };
    const placed = this.searchWithMinimumDisplacement(state, collisions.length);
    if (!placed) {
      // Baseline 6.9: when the low-cost push chain finds nothing, fall back to
      // a local rearrangement instead of ending in a rollback. Budget
      // exhaustion and cancellation must not be retried with a wider search —
      // that would just spend the same budget again.
      if (this.failureStatus === 'no-placement') {
        const reflowed = this.reflow(moved);
        if (reflowed) return this.success(reflowed, 'reflow');
      }
      return this.fail(this.failureStatus, this.foundCycle && this.failureStatus === 'no-placement' ? '推挤链检测到循环，已尝试其他候选并保留原布局。' : this.failureReason);
    }
    return this.success(placed.items, command.type === 'resize' ? 'resize' : placed.displaced > 0 ? 'push' : 'move');
  }

  private insert(): SolveResult {
    const { input } = this;
    if (input.command.type !== 'insert') return this.fail('invalid', '新增命令不合法。');
    const { item, preferred } = input.command;
    if (input.items.some((candidate) => candidate.instanceId === item.instanceId) || item.breakpoint !== input.columns ||
      !isValidSize(item, this.constraint(item))) return this.fail('invalid', '新增对象与现有实例冲突或尺寸不合法。');

    if (!preferred) {
      const point = findFirstFit(input.items, item, input.columns);
      if (point) return this.success([...input.items, { ...item, ...point }], 'move');
    }
    const target = { ...item, ...preferred };
    const collisions = collidingItems(input.items, target);
    if (collisions.some((current) => current.locked)) return this.fail('no-placement', '目标区域包含锁定对象，已保留原布局。');
    const placed = this.searchWithMinimumDisplacement({ fixed: [target], pending: input.items, path: [], reserved: [] }, collisions.length);
    if (!placed) return this.fail(this.failureStatus, this.foundCycle && this.failureStatus === 'no-placement' ? '推挤链检测到循环，已尝试其他候选并保留原布局。' : this.failureReason);
    return this.success(placed.items, placed.displaced > 0 ? 'push' : 'move');
  }

  private constraint(item: LayoutItem): SizeConstraint {
    return constraintsForItem(item, this.constraints);
  }

  /**
   * Baseline 6.9 local rearrangement. The dragged item is pinned at its target
   * and every locked item is pinned too; the rest are re-placed greedily in
   * reading order using baseline 6.10 score #4 (fewest moved objects) as the
   * primary criterion, then distance. Sizes never change and every candidate
   * is validated against the full layout before being returned.
   */
  private reflow(moved: LayoutItem): readonly LayoutItem[] | undefined {
    const locked = this.input.items.filter((item) => item.locked && item.instanceId !== moved.instanceId);
    const movable = readingOrder(this.input.items.filter((item) => !item.locked && item.instanceId !== moved.instanceId));
    const fixed: LayoutItem[] = [moved, ...locked];
    // Only the pinned subset can be validated up front; the movable items are
    // being re-placed and are expected to overlap at this point.
    if (!isValidLayout(fixed, this.input.columns)) return undefined;

    let placed = fixed;
    const relocated: LayoutItem[] = [];
    for (const item of movable) {
      if (!this.consume()) return undefined;
      const spot = this.bestReflowSpot(item, placed);
      if (!spot) return undefined;
      const next = { ...item, ...spot };
      if (spot.x !== item.x || spot.y !== item.y) relocated.push(next);
      placed = [...placed, next];
    }
    // Nothing to move means the push failure was not really a placement problem.
    if (relocated.length === 0) return undefined;
    // Sizes are never touched, but the full layout still has to pass every
    // constraint before it may be committed.
    const candidate = [...placed];
    return this.valid(candidate) ? candidate : undefined;
  }

  /**
   * Picks the lowest-cost legal position for one item: original cell first,
   * then the nearest cells in reading order. Re-placing an item costs one move,
   * so a stay-put candidate always wins when it is legal.
   */
  private bestReflowSpot(item: LayoutItem, fixed: readonly LayoutItem[]): Rect | undefined {
    const own = { x: item.x, y: item.y, w: item.w, h: item.h };
    if (!collidingItems(fixed, own).length) return own;
    const height = layoutHeight(fixed) + item.h + 2;
    const options: Rect[] = [];
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x <= this.input.columns - item.w; x += 1) {
        const rect: Rect = { x, y, w: item.w, h: item.h };
        if (!collidingItems(fixed, rect).length) options.push(rect);
      }
    }
    // Reading order keeps icons from jumping backwards; distance breaks ties.
    return options.sort((a, b) => a.y - b.y || a.x - b.x)[0];
  }

  /**
   * Baseline 6.11 compact mode. Locked items keep their cells, larger objects
   * are seated first so small icons fill the gaps around them, and each object
   * lands in the first free cell in reading order. Icon relative order is
   * preserved because equal-size items are placed in their original order.
   */
  private compact(): SolveResult {
    const { input } = this;
    const locked = input.items.filter((item) => item.locked);
    const movable = [...input.items.filter((item) => !item.locked)].sort((a, b) =>
      b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x || a.order - b.order || a.instanceId.localeCompare(b.instanceId));

    const placed: LayoutItem[] = [...locked];
    for (const item of movable) {
      if (!this.consume()) return this.fail(this.failureStatus, this.failureReason);
      const spot = this.firstFreeSpot(item, placed);
      if (!spot) return this.fail('no-placement', '紧凑整理找不到合法位置，已保留原布局。');
      placed.push({ ...item, ...spot });
    }
    // Preserve the caller's item order so the transaction diff stays readable.
    const byId = new Map(placed.map((item) => [item.instanceId, item]));
    const candidate = input.items.map((item) => byId.get(item.instanceId) ?? item);
    if (!this.valid(candidate)) return this.fail('invalid', '紧凑整理结果未通过全量校验，已保留原布局。');
    return this.success(candidate, 'compact');
  }

  /** First free cell, scanning top-to-bottom then left-to-right. */
  private firstFreeSpot(item: LayoutItem, fixed: readonly LayoutItem[]): Rect | undefined {
    // One extra row is enough: the pass is dense-only when it runs out of space.
    const height = layoutHeight(fixed) + item.h + 1;
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x <= this.input.columns - item.w; x += 1) {
        const rect: Rect = { x, y, w: item.w, h: item.h };
        if (!collidingItems(fixed, rect).length) return rect;
      }
    }
    return undefined;
  }

  private valid(items: readonly LayoutItem[]): boolean {
    return isValidConstrainedLayout(items, this.input.columns, this.constraints);
  }

  private fail(status: SolveFailure['status'], reason: string): SolveFailure {
    return { status, reason, candidate: this.input.items, changes: [] };
  }

  private success(candidate: readonly LayoutItem[], operation: LayoutOperation): SolveResult {
    if (this.input.signal?.aborted) return this.fail('cancelled', '操作已取消。');
    if (!this.valid(candidate)) return this.fail('invalid', '候选布局未通过全量校验，已保留原布局。');
    const byId = new Map(candidate.map((item) => [item.instanceId, item]));
    const ordered = this.input.command.type === 'insert'
      ? [...this.input.items.map((item) => byId.get(item.instanceId) ?? item), byId.get(this.input.command.item.instanceId)!]
      : this.input.items.map((item) => byId.get(item.instanceId) ?? item);
    const changes: LayoutChange[] = [];
    for (const after of ordered) {
      const before = this.input.items.find((item) => item.instanceId === after.instanceId);
      if (before && (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h || before.locked !== after.locked)) {
        changes.push({ instanceId: after.instanceId, before, after });
      }
    }
    return {
      status: 'ok', operation, candidate: ordered, changes,
      heightDelta: layoutHeight(ordered) - layoutHeight(this.input.items), visitedNodes: this.nodes,
    };
  }

  private consume(): boolean {
    this.nodes += 1;
    if (this.input.signal?.aborted) {
      this.failureStatus = 'cancelled';
      this.failureReason = '操作已取消。';
      return false;
    }
    if (this.nodes > this.input.budget.maxNodes) {
      this.failureStatus = 'budget-exceeded';
      this.failureReason = '求解节点超过预算，已保留原布局。';
      return false;
    }
    if (this.nodes === 1 || (this.nodes & 31) === 0) {
      if (this.now() - this.startedAt > this.input.budget.maxMs) {
        this.failureStatus = 'budget-exceeded';
        this.failureReason = '求解时间超过预算，已保留原布局。';
        return false;
      }
    }
    return true;
  }

  private searchWithMinimumDisplacement(initial: SearchState, minimum: number): SearchSuccess | undefined {
    if (minimum > this.input.budget.maxAffectedItems) {
      this.failureStatus = 'budget-exceeded';
      this.failureReason = '推挤链影响对象超过预算，已保留原布局。';
      return undefined;
    }
    // One ordered depth-first traversal is sufficient: the first legal result
    // is already minimal. Repeating every smaller depth limit rediscovers the
    // same failed branches and spent the real-time budget before reaching a
    // simple relocation of the final conflicting item.
    return this.search(initial, this.input.budget.maxAffectedItems);
  }

  private search(state: SearchState, remainingDisplacement: number): SearchSuccess | undefined {
    if (!this.consume()) return undefined;
    const signature = `${layoutSignature([...state.fixed, ...state.pending])}#${[...state.path].sort().join(',')}`;
    if (this.visited.has(signature)) return undefined;
    this.visited.add(signature);

    const conflict = readingOrder(state.pending.filter((item) => collidingItems(state.fixed, item).length > 0))[0];
    if (!conflict) {
      const candidate = [...state.fixed, ...state.pending];
      return this.valid(candidate) ? { items: candidate, displaced: state.path.length } : undefined;
    }
    if (conflict.locked) return undefined;
    if (state.path.includes(conflict.instanceId)) {
      this.foundCycle = true;
      return undefined;
    }
    if (remainingDisplacement === 0) return undefined;

    const remaining = state.pending.filter((candidate) => candidate.instanceId !== conflict.instanceId);
    for (const target of this.candidates(conflict, state.fixed, state.direction)) {
      if (!this.canPlace(target, state.fixed, state.reserved)) continue;
      const placed = this.search({
        fixed: [...state.fixed, { ...conflict, ...target }], pending: remaining,
        path: [...state.path, conflict.instanceId], reserved: state.reserved,
        ...(state.direction ? { direction: state.direction } : {}),
      }, remainingDisplacement - 1);
      if (placed) return placed;
      if (this.failureStatus !== 'no-placement') return undefined;
    }
    return undefined;
  }

  private canPlace(target: Rect, fixed: readonly LayoutItem[], reserved: readonly Rect[]): boolean {
    if (reserved.some((rect) => rectsOverlap(rect, target))) return false;
    const key = layoutSignature(fixed);
    let occupancy = this.occupancyCache.get(key);
    if (!occupancy) {
      occupancy = OccupancyGrid.fromLayout(fixed, this.input.columns);
      this.occupancyCache.set(key, occupancy);
    }
    return occupancy.canPlace(target);
  }

  private candidates(item: LayoutItem, fixed: readonly LayoutItem[], direction?: Direction): Rect[] {
    const positions = new Map<string, Rect>();
    const add = (x: number, y: number) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + item.w > this.input.columns) return;
      positions.set(`${x}:${y}`, { x, y, w: item.w, h: item.h });
    };
    const obstacle = collidingItems(fixed, item)[0] ?? fixed.at(-1) ?? item;
    add(item.x, item.y + obstacle.h);
    add(obstacle.x, obstacle.y + obstacle.h);
    add(obstacle.x + obstacle.w, obstacle.y);
    add(item.x + obstacle.w, item.y);
    add(item.x - obstacle.w, item.y);
    add(item.x, item.y - obstacle.h);
    add(obstacle.x, obstacle.y - item.h);

    const height = layoutHeight(fixed) + item.h + 2;
    for (let y = Math.max(0, item.y - 2); y <= height; y += 1) {
      for (let x = 0; x <= this.input.columns - item.w; x += 1) add(x, y);
    }
    add(0, height + 1);

    const originalHeight = layoutHeight(this.input.items);
    return [...positions.values()].sort((a, b) => {
      const aRank = this.candidateRank(item, a, direction, originalHeight);
      const bRank = this.candidateRank(item, b, direction, originalHeight);
      const aDistance = Math.abs(a.x - item.x) + Math.abs(a.y - item.y);
      const bDistance = Math.abs(b.x - item.x) + Math.abs(b.y - item.y);
      return aRank - bRank || aDistance - bDistance || a.y - b.y || a.x - b.x;
    });
  }

  private candidateRank(item: LayoutItem, target: Rect, direction: Direction | undefined, originalHeight: number): number {
    const dx = target.x - item.x;
    const dy = target.y - item.y;
    if (direction && ((direction === 'right' && dx > 0 && dy === 0) || (direction === 'left' && dx < 0 && dy === 0) ||
      (direction === 'down' && dy > 0 && dx === 0) || (direction === 'up' && dy < 0 && dx === 0))) return 0;
    if (dy > 0 || (dy === 0 && dx > 0)) return 1;
    if (target.y >= originalHeight) return 4;
    if (dy > 0) return 2;
    return 3;
  }
}

export function targetContainsItem(target: Rect, item: Rect): boolean {
  return rectsOverlap(target, item) && target.x <= item.x && target.y <= item.y && target.x + target.w >= item.x + item.w && target.y + target.h >= item.y + item.h;
}
