import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout } from '@/src/domain/grid/solver';
import { layoutHeight } from '@/src/domain/grid/occupancy';

/**
 * Property test for the compact tidy (baseline 6.11) and the local
 * rearrangement fallback (6.9). The invariants below are the same ones the
 * 2A acceptance relies on, so a regression in either new path fails here.
 */

function placeRandom(
  columns: GridColumns,
  sizes: readonly { id: string; w: number; h: number; locked: boolean }[],
  random: () => number,
): LayoutItem[] | undefined {
  const placed: LayoutItem[] = [];
  for (const [order, size] of sizes.entries()) {
    const candidates: LayoutItem[] = [];
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x <= columns - size.w; x += 1) {
        const item: LayoutItem = {
          instanceId: size.id,
          kind: size.w === 1 && size.h === 1 ? 'shortcut' : 'widget',
          breakpoint: columns, locked: size.locked, order,
          x, y, w: size.w, h: size.h,
        };
        if (isValidConstrainedLayout([...placed, item], columns)) candidates.push(item);
      }
    }
    if (!candidates.length) return undefined;
    placed.push(candidates[Math.floor(random() * candidates.length)]!);
  }
  return placed;
}

describe('compact tidy properties', () => {
  it('never changes sizes, locked cells or the instance set, and never grows the page', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (seed) => {
      const columns = [5, 8, 10][seed % 3] as GridColumns;
      let state = seed;
      const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
      const sizes = Array.from({ length: 1 + (seed % 6) }, (_, index) => ({
        id: `icon-${index}`, w: 1, h: 1,
        // Roughly a third of the items are locked.
        locked: (seed + index) % 3 === 0,
      }));
      if (seed % 4 === 0) sizes.push({ id: 'wide', w: Math.min(2, columns), h: 2, locked: false });
      const items = placeRandom(columns, sizes, random);
      if (!items) return true;

      const result = solveLayout({
        items, columns, command: { type: 'compact' },
        budget: { ...DEFAULT_SOLVE_BUDGET, maxMs: 10_000 },
      });
      if (result.status !== 'ok') {
        // A refusal is only allowed to be a clean rollback.
        expect(result.candidate).toEqual(items);
        expect(result.changes).toEqual([]);
        return true;
      }

      expect(isValidConstrainedLayout(result.candidate, columns)).toBe(true);
      const ids = result.candidate.map((entry) => entry.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(items.map((entry) => entry.instanceId).sort());

      for (const before of items) {
        const after = result.candidate.find((entry) => entry.instanceId === before.instanceId)!;
        // 14.2 #12: tidy never resizes anything.
        expect(after.w).toBe(before.w);
        expect(after.h).toBe(before.h);
        // 14.2 #10 / 6.8: locked objects keep their exact cell.
        if (before.locked) expect(after).toEqual(before);
      }
      // 6.11: tidying must not make the page taller.
      expect(layoutHeight(result.candidate)).toBeLessThanOrEqual(layoutHeight(items));
      // Deterministic: the same input yields the same geometry.
      const again = solveLayout({
        items, columns, command: { type: 'compact' },
        budget: { ...DEFAULT_SOLVE_BUDGET, maxMs: 10_000 },
      });
      expect(again.status).toBe('ok');
      if (again.status === 'ok') {
        const geometry = (layout: readonly LayoutItem[]) =>
          layout.map((entry) => `${entry.instanceId}:${entry.x},${entry.y}`).sort().join('|');
        expect(geometry(again.candidate)).toBe(geometry(result.candidate));
      }
      return true;
    }), { numRuns: 80, seed: 0x2b2026 });
  });
});
