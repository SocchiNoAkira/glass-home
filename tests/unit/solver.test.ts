import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout, type SolveInput } from '@/src/domain/grid/solver';

function item(id: string, x: number, y: number, w = 1, h = 1, columns: GridColumns = 10): LayoutItem {
  return { instanceId: id, kind: id.startsWith('widget') ? 'widget' : 'shortcut', breakpoint: columns, locked: false, order: 0, x, y, w, h };
}

function solve(items: LayoutItem[], command: SolveInput['command'], columns: GridColumns = 10, budget = DEFAULT_SOLVE_BUDGET) {
  return solveLayout({ items, columns, command, budget });
}

describe('deterministic layout solver', () => {
  it('moves to an empty space without affecting any other item', () => {
    const items = [item('a', 0, 0), item('b', 1, 0)];
    const result = solve(items, { type: 'move', instanceId: 'a', target: { x: 5, y: 4, w: 1, h: 1 } });
    expect(result).toMatchObject({ status: 'ok', operation: 'move', heightDelta: 4 });
    expect(result.changes.map((change) => change.instanceId)).toEqual(['a']);
    expect(result.candidate).toEqual([item('a', 5, 4), item('b', 1, 0)]);
    expect(items[0]).toEqual(item('a', 0, 0));
  });

  it('swaps equal-size items without touching their sizes or third parties', () => {
    const items = [item('a', 0, 0), item('b', 1, 0), item('third', 5, 5)];
    const result = solve(items, { type: 'move', instanceId: 'a', target: { x: 1, y: 0, w: 1, h: 1 } });
    expect(result).toMatchObject({ status: 'ok', operation: 'swap' });
    expect(result.candidate.find((entry) => entry.instanceId === 'third')).toEqual(items[2]);
    expect(result.candidate.find((entry) => entry.instanceId === 'a')).toMatchObject({ x: 1, y: 0, w: 1, h: 1 });
    expect(result.candidate.find((entry) => entry.instanceId === 'b')).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('swaps different sizes only when both original regions are legal', () => {
    const items = [item('widget-a', 0, 0, 2, 2), item('b', 4, 0, 1, 1), item('third', 5, 5)];
    const result = solve(items, { type: 'move', instanceId: 'widget-a', target: { x: 4, y: 0, w: 2, h: 2 } });
    expect(result).toMatchObject({ status: 'ok', operation: 'swap' });
    expect(result.candidate.find((entry) => entry.instanceId === 'widget-a')).toMatchObject({ x: 4, y: 0, w: 2, h: 2 });
    expect(result.candidate.find((entry) => entry.instanceId === 'b')).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('returns a legal swap immediately even when pushing would exhaust the time budget', () => {
    const workspace = createDefaultWorkspace();
    const result = solveLayout({
      items: workspace.layouts[10], columns: 10,
      command: { type: 'move', instanceId: 'github', target: { x: 1, y: 3, w: 1, h: 1 } },
      budget: DEFAULT_SOLVE_BUDGET,
    });
    expect(result).toMatchObject({ status: 'ok', operation: 'swap' });
    expect(result.changes.map((change) => change.instanceId).sort()).toEqual(['figma', 'github']);
    expect(result.status === 'ok' && result.visitedNodes).toBe(0);
    expect(solveLayout({
      items: workspace.layouts[10], columns: 10,
      command: { type: 'move', instanceId: 'github', target: { x: 1, y: 3, w: 1, h: 1 } },
      budget: DEFAULT_SOLVE_BUDGET, preference: 'push-first',
    })).toMatchObject({ status: 'ok', operation: 'push' });
  });

  it('pushes rather than illegally swapping a large widget into a shortcut cluster', () => {
    const items = [item('widget-a', 0, 0, 2, 2), item('a', 3, 0), item('b', 4, 0), item('c', 5, 0)];
    const result = solve(items, { type: 'move', instanceId: 'widget-a', target: { x: 3, y: 0, w: 2, h: 2 } });
    expect(result.status).toBe('ok');
    expect(result.candidate.find((entry) => entry.instanceId === 'widget-a')).toMatchObject({ x: 3, y: 0, w: 2, h: 2 });
    expect(result.candidate.find((entry) => entry.instanceId === 'a')).toMatchObject({ w: 1, h: 1 });
    expect(isValidConstrainedLayout(result.candidate, 10)).toBe(true);
  });

  it('moves the tail to the next row when pushing into a full row', () => {
    const items = Array.from({ length: 10 }, (_, x) => item(`icon-${x}`, x, 0));
    const result = solveLayout({ items, columns: 10, command: { type: 'move', instanceId: 'icon-9', target: { x: 0, y: 0, w: 1, h: 1 } }, preference: 'push-first', budget: DEFAULT_SOLVE_BUDGET });
    expect(result).toMatchObject({ status: 'ok', operation: 'push' });
    expect(isValidConstrainedLayout(result.candidate, 10)).toBe(true);
    expect(result.candidate.some((entry) => entry.y === 1)).toBe(true);
    expect(result.candidate).toHaveLength(10);
  });

  it('adds rows at the page end rather than shrinking or dropping instances', () => {
    const items = Array.from({ length: 10 }, (_, x) => item(`icon-${x}`, x, 0));
    const extra = item('extra', 0, 1, 1, 1);
    const result = solve(items, { type: 'insert', item: extra, preferred: { x: 0, y: 0 } });
    expect(result.status).toBe('ok');
    expect(result.candidate).toHaveLength(11);
    expect(result.candidate.some((entry) => entry.y >= 1)).toBe(true);
    expect(isValidConstrainedLayout(result.candidate, 10)).toBe(true);
  });

  it('resizes only to a declared preset and pushes neighbours without shrinking them', () => {
    const items = [item('widget-a', 0, 0, 2, 2), item('a', 2, 0), item('b', 3, 0)];
    const result = solve(items, { type: 'resize', instanceId: 'widget-a', target: { x: 0, y: 0, w: 4, h: 2 } });
    expect(result).toMatchObject({ status: 'ok', operation: 'resize' });
    expect(result.candidate.find((entry) => entry.instanceId === 'widget-a')).toMatchObject({ w: 4, h: 2 });
    expect(result.candidate.find((entry) => entry.instanceId === 'a')).toMatchObject({ w: 1, h: 1 });
    expect(result.candidate.find((entry) => entry.instanceId === 'b')).toMatchObject({ w: 1, h: 1 });
    expect(isValidConstrainedLayout(result.candidate, 10)).toBe(true);
  });

  it('resizes the real calendar within budget on every default breakpoint', () => {
    const workspace = createDefaultWorkspace();
    for (const columns of [10, 8, 5] as const) {
      const items = workspace.layouts[columns];
      const calendar = items.find((entry) => entry.instanceId === 'builtin.calendar')!;
      const command: SolveInput['command'] = { type: 'resize', instanceId: calendar.instanceId, target: { x: calendar.x, y: calendar.y, w: 4, h: 4 } };
      const result = solveLayout({ items, columns, command, budget: DEFAULT_SOLVE_BUDGET });
      expect(result.status, `${columns} 列默认布局应在预算内完成尺寸调整`).toBe('ok');
      expect(isValidConstrainedLayout(result.candidate, columns)).toBe(true);
      expect(result.candidate.map((entry) => entry.instanceId).sort()).toEqual(items.map((entry) => entry.instanceId).sort());
      for (const before of items) {
        const after = result.candidate.find((entry) => entry.instanceId === before.instanceId)!;
        if (before.instanceId !== calendar.instanceId) expect(after).toMatchObject({ w: before.w, h: before.h, locked: before.locked });
        if (before.locked) expect(after).toEqual(before);
      }
      expect(solveLayout({ items, columns, command, budget: DEFAULT_SOLVE_BUDGET })).toEqual(result);
    }
  });

  it('locks and unlocks an item without moving it', () => {
    const items = [item('a', 0, 0)];
    const locked = solve(items, { type: 'set-lock', instanceId: 'a', locked: true });
    expect(locked).toMatchObject({ status: 'ok', operation: 'lock' });
    expect(locked.changes).toHaveLength(1);
    expect(locked.candidate[0]).toMatchObject({ x: 0, y: 0, locked: true });
    const unlocked = solve(locked.candidate as LayoutItem[], { type: 'set-lock', instanceId: 'a', locked: false });
    expect(unlocked).toMatchObject({ status: 'ok', operation: 'lock' });
    expect(unlocked.candidate[0]).toMatchObject({ x: 0, y: 0, locked: false });
  });

  it('never moves locked objects automatically or by a direct command', () => {
    const items = [{ ...item('a', 0, 0), locked: true }, item('b', 1, 0)];
    expect(solve(items, { type: 'move', instanceId: 'b', target: { x: 0, y: 0, w: 1, h: 1 } }).status).toBe('no-placement');
    expect(solve(items, { type: 'move', instanceId: 'a', target: { x: 4, y: 4, w: 1, h: 1 } }).status).toBe('no-placement');
    expect(items[0]).toMatchObject({ x: 0, y: 0, locked: true });
  });

  it('preserves the builtin default layouts under the constrained validator', () => {
    const workspace = createDefaultWorkspace();
    for (const columns of [10, 8, 5] as const) expect(isValidConstrainedLayout(workspace.layouts[columns], columns)).toBe(true);
  });

  it('rejects invalid target sizes without mutating the original layout', () => {
    const items = [item('a', 0, 0)];
    const result = solve(items, { type: 'resize', instanceId: 'a', target: { x: 0, y: 0, w: 2, h: 2 } });
    expect(result).toMatchObject({ status: 'no-placement', candidate: items, changes: [] });
  });

  it('honours cancellation and budget exhaustion with the original candidate', () => {
    const items = [item('a', 0, 0), item('b', 1, 0)];
    const cancelled = solveLayout({ items, columns: 10, command: { type: 'move', instanceId: 'a', target: { x: 4, y: 0, w: 1, h: 1 } }, budget: DEFAULT_SOLVE_BUDGET, signal: AbortSignal.abort() });
    expect(cancelled).toMatchObject({ status: 'cancelled', candidate: items });
    const limited = solveLayout({ items, columns: 10, command: { type: 'move', instanceId: 'a', target: { x: 1, y: 0, w: 1, h: 1 } }, preference: 'push-first', budget: { maxNodes: 1, maxMs: 40, maxAffectedItems: 40 } });
    expect(limited.status).not.toBe('ok');
    expect(limited.candidate).toEqual(items);
  });
});
