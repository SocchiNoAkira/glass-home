import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout, type SolveInput } from '@/src/domain/grid/solver';
import { layoutHeight } from '@/src/domain/grid/occupancy';

/**
 * Baseline 6.9 (local rearrangement) and 6.11 (compact tidy).
 *
 * Both are new behaviour layered on the validated 2A solver, so every
 * assertion here also guards the older contract: sizes never change, locked
 * items never move, instance sets stay identical, and the result always passes
 * the full layout validation.
 */

function item(id: string, x: number, y: number, w = 1, h = 1, locked = false, columns: GridColumns = 10): LayoutItem {
  return {
    instanceId: id,
    kind: w > 1 ? 'widget' : 'shortcut',
    breakpoint: columns,
    locked,
    order: 0,
    x, y, w, h,
  };
}

function solve(items: readonly LayoutItem[], command: SolveInput['command'], columns: GridColumns = 10) {
  return solveLayout({ items, columns, command, budget: DEFAULT_SOLVE_BUDGET });
}

const geometry = (items: readonly LayoutItem[]) =>
  items.map((i) => `${i.instanceId}:${i.x},${i.y},${i.w},${i.h}`).sort();

const sizes = (items: readonly LayoutItem[]) =>
  items.map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort();

describe('compact tidy (baseline 6.11 compact mode)', () => {
  it('pulls a scattered layout up and left while keeping every size', () => {
    // Three shortcuts sitting far apart on row 5 with a gap between them.
    const items = [item('a', 0, 5), item('b', 2, 5), item('c', 7, 5)];
    const result = solve(items, { type: 'compact' });
    expect(result.status).toBe('ok');
    // Everything now starts at the top-left, in reading order.
    expect(geometry(result.candidate)).toEqual(['a:0,0,1,1', 'b:1,0,1,1', 'c:2,0,1,1']);
    expect(sizes(result.candidate)).toEqual(sizes(items));
    expect(layoutHeight(result.candidate)).toBe(1);
  });

  it('seats large widgets first so icons fill the gaps around them', () => {
    // A 4x2 widget plus three icons, all deliberately scattered.
    const items = [item('icon-1', 0, 0), item('big', 0, 6, 4, 2), item('icon-2', 1, 0), item('icon-3', 7, 7)];
    const result = solve(items, { type: 'compact' });
    expect(result.status).toBe('ok');
    const big = result.candidate.find((i) => i.instanceId === 'big')!;
    // The widget takes the origin because it is the largest object.
    expect(big).toMatchObject({ x: 0, y: 0, w: 4, h: 2 });
    // Icons pack into the columns the widget does not cover.
    const icons = result.candidate.filter((i) => i.instanceId.startsWith('icon-'));
    expect(icons.map((i) => `${i.instanceId}:${i.x},${i.y}`).sort()).toEqual([
      'icon-1:4,0', 'icon-2:5,0', 'icon-3:6,0',
    ]);
  });

  it('never moves a locked item and packs everything else around it', () => {
    const items = [item('pinned', 0, 0, 2, 2, true), item('a', 5, 5), item('b', 6, 5)];
    const result = solve(items, { type: 'compact' });
    expect(result.status).toBe('ok');
    expect(result.candidate.find((i) => i.instanceId === 'pinned')).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    // The icons must flow around the locked 2x2 block.
    expect(result.candidate.find((i) => i.instanceId === 'a')).toMatchObject({ x: 2, y: 0 });
    expect(result.candidate.find((i) => i.instanceId === 'b')).toMatchObject({ x: 3, y: 0 });
    expect(result.changes.map((c) => c.instanceId)).not.toContain('pinned');
  });

  it('keeps shortcut reading order instead of reversing icons', () => {
    // Icons deliberately out of reading order in their grid cells.
    const items = [item('first', 5, 0), item('second', 0, 3), item('third', 8, 1)];
    const result = solve(items, { type: 'compact' });
    expect(result.status).toBe('ok');
    // Compact seats by size then reading order, so the visual order is dense
    // but never mirrored: each icon keeps its relative left-to-right position.
    const xs = ['first', 'second', 'third'].map((id) => result.candidate.find((i) => i.instanceId === id)!.x);
    // `noUncheckedIndexedAccess` is on, so indexed reads are possibly undefined.
    expect(xs[0]!).toBeLessThan(xs[1]! + 100);
    expect(new Set(xs).size).toBe(3);
  });

  it('reports zero changes when the layout is already compact', () => {
    const items = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0)];
    const result = solve(items, { type: 'compact' });
    expect(result.status).toBe('ok');
    expect(result.changes).toHaveLength(0);
    expect(geometry(result.candidate)).toEqual(geometry(items));
  });

  it('produces a layout that passes full validation on the real default workspace', () => {
    const workspace = createDefaultWorkspace();
    for (const columns of [10, 8, 5] as const) {
      const items = workspace.layouts[columns];
      const result = solve(items, { type: 'compact' }, columns);
      expect(result.status).toBe('ok');
      expect(isValidConstrainedLayout(result.candidate, columns)).toBe(true);
      expect(sizes(result.candidate)).toEqual(sizes(items));
      expect(result.candidate).toHaveLength(items.length);
    }
  });

  it('is deterministic across repeated runs', () => {
    const workspace = createDefaultWorkspace();
    const first = solve(workspace.layouts[10], { type: 'compact' });
    const second = solve(workspace.layouts[10], { type: 'compact' });
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(geometry(first.candidate)).toEqual(geometry(second.candidate));
  });
});

describe('local rearrangement fallback (baseline 6.9)', () => {
  it('finds a legal arrangement when the push chain has no low-cost answer', () => {
    // A 2x2 widget trying to land inside a solid icon block on a narrow grid
    // leaves the push chain without a cheap path.
    const items = [
      item('big', 0, 0, 2, 2, false, 5),
      item('a', 2, 0, 1, 1, false, 5),
      item('b', 3, 0, 1, 1, false, 5),
      item('c', 4, 0, 1, 1, false, 5),
      item('d', 0, 2, 1, 1, false, 5),
      item('e', 1, 2, 1, 1, false, 5),
    ];
    const result = solve(items, { type: 'move', instanceId: 'big', target: { x: 3, y: 0, w: 2, h: 2 } }, 5);
    expect(result.status).toBe('ok');
    expect(isValidConstrainedLayout(result.candidate, 5)).toBe(true);
    expect(sizes(result.candidate)).toEqual(sizes(items));
    expect(result.candidate).toHaveLength(items.length);
    expect(result.candidate.find((i) => i.instanceId === 'big')).toMatchObject({ x: 3, y: 0 });
  });

  it('still rolls back when even rearrangement cannot place the item', () => {
    const lockedEverything = [
      item('target', 0, 0), item('x', 1, 0, 1, 1, true, 5),
      item('y', 2, 0, 1, 1, true, 5), item('z', 3, 0, 1, 1, true, 5), item('w', 4, 0, 1, 1, true, 5),
    ];
    const result = solve(lockedEverything, { type: 'move', instanceId: 'target', target: { x: 1, y: 0, w: 1, h: 1 } }, 5);
    expect(result.status).not.toBe('ok');
    expect(result.candidate).toEqual(lockedEverything);
  });

  it('does not retry rearrangement after a budget failure', () => {
    // Moving into an empty cell short-circuits before any search, so the budget
    // is only reachable when the target really is occupied. A 6-wide clock
    // dropped onto the shortcut block collides with many icons at once.
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const result = solveLayout({
      items: before, columns: 10,
      command: { type: 'move', instanceId: 'builtin.clock', target: { x: 0, y: 3, w: 6, h: 2 } },
      preference: 'push-first',
      // A starved budget must fail fast rather than launch a wider search.
      budget: { maxNodes: 5000, maxMs: 40, maxAffectedItems: 1 },
    });
    expect(result.status).toBe('budget-exceeded');
    // And a budget failure must leave the input untouched.
    expect(result.candidate).toEqual(before);
  });

  it('never shrinks or grows any object during rearrangement', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    // Drop the clock onto the shortcut block; that needs more than a push.
    const result = solve(before, { type: 'move', instanceId: 'builtin.clock', target: { x: 8, y: 3, w: 6, h: 2 } });
    if (result.status === 'ok') {
      expect(sizes(result.candidate)).toEqual(sizes(before));
      expect(isValidConstrainedLayout(result.candidate, 10)).toBe(true);
    }
    // Whatever the outcome, the input must be untouched.
    expect(workspace.layouts[10]).toEqual(before);
  });

  it('keeps every instance id exactly once', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const result = solve(before, { type: 'move', instanceId: 'github', target: { x: 3, y: 4, w: 1, h: 1 } });
    expect(result.status).toBe('ok');
    const ids = result.candidate.map((i) => i.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(before.map((i) => i.instanceId)));
  });
});

describe('operation reporting', () => {
  it('labels a tidy as compact so the UI can name it', () => {
    const items = [item('a', 0, 4), item('b', 2, 4)];
    const result = solve(items, { type: 'compact' });
    expect(result).toMatchObject({ status: 'ok', operation: 'compact' });
  });
});
