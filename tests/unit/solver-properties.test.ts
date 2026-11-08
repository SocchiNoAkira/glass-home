import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout, type LayoutCommand } from '@/src/domain/grid/solver';

function placeRandomItems(columns: GridColumns, sizes: { id: string; w: number; h: number; locked: boolean }[], random: () => number): LayoutItem[] | undefined {
  const placed: LayoutItem[] = [];
  for (const [order, size] of sizes.entries()) {
    const candidates: LayoutItem[] = [];
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x <= columns - size.w; x += 1) {
        const item: LayoutItem = { instanceId: size.id, kind: size.w === 1 && size.h === 1 ? 'shortcut' : 'widget', breakpoint: columns, locked: size.locked, order, x, y, w: size.w, h: size.h };
        if (isValidConstrainedLayout([...placed, item], columns)) candidates.push(item);
      }
    }
    if (!candidates.length) return undefined;
    placed.push(candidates[Math.floor(random() * candidates.length)]!);
  }
  return placed;
}

describe('layout solver properties', () => {
  it('preserves IDs, geometry constraints and locked positions on random legal layouts', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (seed) => {
      const columns = [5, 8, 10][seed % 3] as GridColumns;
      let state = seed;
      const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
      const sizes = Array.from({ length: 2 + seed % 5 }, (_, index) => ({ id: `icon-${index}`, w: 1, h: 1, locked: index === 0 && seed % 2 === 0 }));
      if (seed % 3 === 0) sizes.push({ id: 'widget-large', w: 2, h: 2, locked: false });
      const items = placeRandomItems(columns, sizes, random);
      if (!items) return true;
      const item = items[seed % items.length]!;
      if (item.locked) return true;
      const command: LayoutCommand = { type: 'move', instanceId: item.instanceId, target: { x: seed % (columns - item.w + 1), y: (seed * 3) % 8, w: item.w, h: item.h } };
      const budget = { ...DEFAULT_SOLVE_BUDGET, maxMs: 10000, maxAffectedItems: Math.max(2, items.length) };
      const preference = seed % 2 ? 'push-first' as const : 'auto' as const;
      const result = solveLayout({ columns, items, command, preference, budget });
      if (result.status !== 'ok') {
        expect(result.candidate).toEqual(items);
        expect(result.changes).toEqual([]);
        return true;
      }
      expect(isValidConstrainedLayout(result.candidate, columns)).toBe(true);
      expect(result.candidate.map((entry) => entry.instanceId).sort()).toEqual(items.map((entry) => entry.instanceId).sort());
      expect(new Set(result.candidate.map((entry) => entry.instanceId)).size).toBe(items.length);
      for (const before of items) {
        const after = result.candidate.find((entry) => entry.instanceId === before.instanceId)!;
        expect(after.w).toBe(before.w);
        expect(after.h).toBe(before.h);
        if (before.locked) expect(after).toEqual(before);
      }
      expect(solveLayout({ columns, items, command, preference, budget })).toEqual(result);
      return true;
    }), { numRuns: 100, seed: 0x2a2026 });
  });
});
