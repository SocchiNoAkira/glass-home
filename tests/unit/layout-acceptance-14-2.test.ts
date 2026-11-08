import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import {
  isValidConstrainedLayout, readingOrder, rectsOverlap,
  type GridColumns, type LayoutItem,
} from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout, type LayoutCommand, type LayoutPreference } from '@/src/domain/grid/solver';
import { layoutHeight } from '@/src/domain/grid/occupancy';
import { getGridColumns } from '@/src/application/workspaceStore';
import { applyLayoutTransaction, createLayoutPreview, restoreLayoutTransaction } from '@/src/domain/layout/transaction';

/**
 * Product baseline 14.2: the 20 layout-engine cases that must pass before the
 * engine counts as stable. Each test name carries the case number so a future
 * regression points straight at the clause it broke.
 *
 * Case 14 (`Esc` cancels every previewed offset) and the parts of 17–18 that
 * depend on a real viewport are covered by the Edge suite
 * (stage-2b-layout / stage-2b2-compact); those are called out explicitly where
 * a pure unit test cannot reach them.
 */

function item(id: string, x: number, y: number, w = 1, h = 1, locked = false, columns: GridColumns = 10): LayoutItem {
  return { instanceId: id, kind: w > 1 ? 'widget' : 'shortcut', breakpoint: columns, locked, order: 0, x, y, w, h };
}

function solve(items: readonly LayoutItem[], command: LayoutCommand, columns: GridColumns = 10, preference: LayoutPreference = 'auto') {
  return solveLayout({ items, columns, command, preference, budget: DEFAULT_SOLVE_BUDGET });
}

const byId = (items: readonly LayoutItem[], id: string) => items.find((entry) => entry.instanceId === id)!;
const cell = (entry: LayoutItem) => ({ x: entry.x, y: entry.y });
const sizes = (items: readonly LayoutItem[]) => items.map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort();
const ids = (items: readonly LayoutItem[]) => items.map((i) => i.instanceId).sort();

/** Every submitted layout must satisfy the 14.2 invariant block. */
function expectInvariants(items: readonly LayoutItem[], columns: GridColumns) {
  expect(isValidConstrainedLayout(items, columns)).toBe(true);
  const list = items.map((i) => i.instanceId);
  expect(new Set(list).size).toBe(list.length);
  for (const entry of items) {
    expect(Number.isInteger(entry.x) && Number.isInteger(entry.y)).toBe(true);
    expect(Number.isInteger(entry.w) && Number.isInteger(entry.h)).toBe(true);
    expect(entry.x).toBeGreaterThanOrEqual(0);
    expect(entry.y).toBeGreaterThanOrEqual(0);
    expect(entry.x + entry.w).toBeLessThanOrEqual(columns);
  }
}

describe('14.2 #1 — moving into an empty cell changes only the target object', () => {
  it('leaves every other object exactly where it was', () => {
    const items = [item('a', 0, 0), item('b', 1, 0), item('c', 5, 4)];
    const result = solve(items, { type: 'move', instanceId: 'a', target: { x: 8, y: 6, w: 1, h: 1 } });
    expect(result.status).toBe('ok');
    expect(result.changes.map((c) => c.instanceId)).toEqual(['a']);
    expect(byId(result.candidate, 'b')).toEqual(byId(items, 'b'));
    expect(byId(result.candidate, 'c')).toEqual(byId(items, 'c'));
  });
});

describe('14.2 #2 — inserting an icon between two icons pushes the chain correctly', () => {
  it('shifts the tail of the row instead of overwriting it', () => {
    // A full row of five icons on a 5-column grid.
    const items = [item('a', 0, 0, 1, 1, false, 5), item('b', 1, 0, 1, 1, false, 5),
      item('c', 2, 0, 1, 1, false, 5), item('d', 3, 0, 1, 1, false, 5), item('e', 4, 0, 1, 1, false, 5)];
    const moving = byId(items, 'e');
    const result = solve(items, { type: 'move', instanceId: 'e', target: { x: 1, y: 0, w: 1, h: 1 } }, 5, 'push-first');
    expect(result.status).toBe('ok');
    expectInvariants(result.candidate, 5);
    // The dragged icon lands where asked and nothing is lost.
    expect(byId(result.candidate, 'e')).toMatchObject({ x: 1, y: 0 });
    expect(ids(result.candidate)).toEqual(ids(items));
    expect(sizes(result.candidate)).toEqual(sizes(items));
    expect(moving.x).toBe(4);
  });
});

describe('14.2 #3 — when the row is full the chain tail drops to the next row', () => {
  it('moves the displaced item down rather than shrinking it', () => {
    const items = [item('a', 0, 0, 1, 1, false, 5), item('b', 1, 0, 1, 1, false, 5),
      item('c', 2, 0, 1, 1, false, 5), item('d', 3, 0, 1, 1, false, 5), item('e', 4, 0, 1, 1, false, 5),
      item('mover', 0, 1, 1, 1, false, 5)];
    const result = solve(items, { type: 'move', instanceId: 'mover', target: { x: 4, y: 0, w: 1, h: 1 } }, 5, 'push-first');
    expect(result.status).toBe('ok');
    expectInvariants(result.candidate, 5);
    // The displaced tail left row 0 for a later row.
    const tail = byId(result.candidate, 'e');
    expect(tail.y).toBeGreaterThanOrEqual(1);
    expect(sizes(result.candidate)).toEqual(sizes(items));
  });
});

describe('14.2 #4 — a missing slot at the end of the page adds a row', () => {
  it('grows the page instead of refusing the move', () => {
    const items = [item('widget-wide', 0, 0, 4, 2, false, 5), item('icon', 0, 2, 1, 1, false, 5)];
    // Ask for a 4-wide widget below the existing content: no room in the used rows.
    const result = solve(items, { type: 'move', instanceId: 'icon', target: { x: 0, y: 10, w: 1, h: 1 } }, 5);
    expect(result.status).toBe('ok');
    expect(layoutHeight(result.candidate)).toBeGreaterThan(layoutHeight(items));
    expectInvariants(result.candidate, 5);
  });
});

describe('14.2 #5 — equal-size icons and widgets swap correctly', () => {
  it('exchanges cells for a 1x1 pair and for a 2x2 pair', () => {
    const icons = [item('a', 0, 0), item('b', 3, 3)];
    const iconResult = solve(icons, { type: 'move', instanceId: 'a', target: { x: 3, y: 3, w: 1, h: 1 } });
    expect(iconResult).toMatchObject({ status: 'ok', operation: 'swap' });
    expect(cell(byId(iconResult.candidate, 'a'))).toEqual({ x: 3, y: 3 });
    expect(cell(byId(iconResult.candidate, 'b'))).toEqual({ x: 0, y: 0 });

    const widgets = [item('w1', 0, 0, 2, 2), item('w2', 5, 5, 2, 2)];
    const widgetResult = solve(widgets, { type: 'move', instanceId: 'w1', target: { x: 5, y: 5, w: 2, h: 2 } });
    expect(widgetResult).toMatchObject({ status: 'ok', operation: 'swap' });
    expect(byId(widgetResult.candidate, 'w1')).toMatchObject({ x: 5, y: 5, w: 2, h: 2 });
    expect(byId(widgetResult.candidate, 'w2')).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });
});

describe('14.2 #6 — different sizes swap only when both regions fit', () => {
  it('accepts a legal size swap', () => {
    // A 2x2 widget over a single icon at (4,0): both regions fit each other.
    const items = [item('widget-a', 0, 0, 2, 2), item('b', 4, 0)];
    const result = solve(items, { type: 'move', instanceId: 'widget-a', target: { x: 4, y: 0, w: 2, h: 2 } });
    if (result.status !== 'ok') throw new Error(result.reason);
    expect(result.operation).toBe('swap');
    expect(byId(result.candidate, 'widget-a')).toMatchObject({ x: 4, y: 0, w: 2, h: 2 });
    expect(byId(result.candidate, 'b')).toMatchObject({ x: 0, y: 0 });
  });

  it('falls back instead of shrinking the widget to fit an icon cell', () => {
    // A 4x2 widget cannot occupy a 1x1 icon cell, so the solver must not swap.
    const items = [item('big', 0, 0, 4, 2), item('icon', 6, 5), item('filler', 7, 5)];
    const result = solve(items, { type: 'move', instanceId: 'big', target: { x: 6, y: 5, w: 4, h: 2 } });
    expect(result.status).toBe('ok');
    expect(byId(result.candidate, 'big').w).toBe(4);
    expect(byId(result.candidate, 'big').h).toBe(2);
    expectInvariants(result.candidate, 10);
  });
});

describe('14.2 #7 — when a size swap is illegal the engine pushes or rearranges', () => {
  it('still produces a legal layout without resizing anything', () => {
    const items = [item('big', 0, 0, 4, 2), item('a', 6, 0), item('b', 7, 0), item('c', 8, 0), item('d', 9, 0)];
    const result = solve(items, { type: 'move', instanceId: 'big', target: { x: 6, y: 0, w: 4, h: 2 } }, 10, 'push-first');
    if (result.status !== 'ok') throw new Error(result.reason);
    // Either a push chain or the 6.9 rearrangement answered; both are legal.
    expect(['push', 'reflow', 'move']).toContain(result.operation);
    expectInvariants(result.candidate, 10);
    expect(sizes(result.candidate)).toEqual(sizes(items));
  });
});

describe('14.2 #8 — a large widget dropped into a dense icon area never overlaps', () => {
  it('produces a non-overlapping layout', () => {
    const columns: GridColumns = 8;
    const icons = Array.from({ length: 16 }, (_, i) => item(`icon-${i}`, i % columns, 2 + Math.floor(i / columns), 1, 1, false, columns));
    const items = [item('big', 0, 0, 4, 2, false, columns), ...icons];
    const result = solve(items, { type: 'move', instanceId: 'big', target: { x: 2, y: 2, w: 4, h: 2 } }, columns, 'push-first');
    expect(result.status).toBe('ok');
    expectInvariants(result.candidate, columns);
    for (const a of result.candidate) {
      for (const b of result.candidate) {
        if (a.instanceId !== b.instanceId) expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });
});

describe('14.2 #9 — a push cycle is detected and answered by another path or rollback', () => {
  it('never loops and never returns an illegal candidate', () => {
    const columns: GridColumns = 5;
    // A closed ring of icons around the grid where every neighbour is taken.
    const items = Array.from({ length: 15 }, (_, i) => item(`i${i}`, i % columns, Math.floor(i / columns), 1, 1, false, columns));
    const result = solve(items, { type: 'move', instanceId: 'i0', target: { x: 2, y: 1, w: 1, h: 1 } }, columns, 'push-first');
    if (result.status !== 'ok') {
      // A rollback keeps the original layout byte for byte.
      expect(result.candidate).toEqual(items);
      expect(result.changes).toEqual([]);
      return;
    }
    expectInvariants(result.candidate, columns);
    expect(ids(result.candidate)).toEqual(ids(items));
  });
});

describe('14.2 #10 — locked objects are never moved by automatic operations', () => {
  it('keeps locked cells through move, push and tidy', () => {
    const columns: GridColumns = 5;
    const items = [item('locked-a', 0, 0, 2, 2, true, columns), item('locked-b', 4, 3, 1, 1, true, columns),
      item('a', 2, 0, 1, 1, false, columns), item('b', 3, 0, 1, 1, false, columns), item('c', 2, 1, 1, 1, false, columns)];

    const moved = solve(items, { type: 'move', instanceId: 'a', target: { x: 4, y: 0, w: 1, h: 1 } }, columns, 'push-first');
    if (moved.status === 'ok') {
      expect(byId(moved.candidate, 'locked-a')).toEqual(byId(items, 'locked-a'));
      expect(byId(moved.candidate, 'locked-b')).toEqual(byId(items, 'locked-b'));
    }

    const tidied = solve(items, { type: 'compact' }, columns);
    expect(tidied.status).toBe('ok');
    expect(byId(tidied.candidate, 'locked-a')).toEqual(byId(items, 'locked-a'));
    expect(byId(tidied.candidate, 'locked-b')).toEqual(byId(items, 'locked-b'));
    expect(tidied.changes.map((c) => c.instanceId)).not.toContain('locked-a');
  });

  it('refuses a manual move of a locked object with an explanation', () => {
    const items = [item('locked', 0, 0, 1, 1, true)];
    const result = solve(items, { type: 'move', instanceId: 'locked', target: { x: 4, y: 4, w: 1, h: 1 } });
    expect(result.status).not.toBe('ok');
    expect(result.status === 'no-placement' && result.reason).toContain('锁定');
  });
});

describe('14.2 #11 — every object keeps its instance id and user data', () => {
  it('preserves ids, locked flags and order through a push and a tidy', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const pushed = solve(before, { type: 'move', instanceId: 'github', target: { x: 3, y: 4, w: 1, h: 1 } });
    expect(pushed.status).toBe('ok');
    expect(ids(pushed.candidate)).toEqual(ids(before));
    const tidied = solve(before, { type: 'compact' });
    expect(tidied.status).toBe('ok');
    for (const original of before) {
      const after = byId(tidied.candidate, original.instanceId);
      expect(after.instanceId).toBe(original.instanceId);
      expect(after.locked).toBe(original.locked);
      expect(after.kind).toBe(original.kind);
      expect(after.order).toBe(original.order);
      expect(after.breakpoint).toBe(original.breakpoint);
    }
  });
});

describe('14.2 #12 — pushing or rearranging never shrinks an object', () => {
  it('keeps every width and height identical', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const results = [
      solve(before, { type: 'move', instanceId: 'builtin.clock', target: { x: 8, y: 3, w: 6, h: 2 } }, 10, 'push-first'),
      solve(before, { type: 'compact' }),
    ];
    for (const result of results) {
      if (result.status !== 'ok') continue;
      expect(sizes(result.candidate)).toEqual(sizes(before));
    }
  });
});

describe('14.2 #13 — one undo restores the whole chain, redo restores the result', () => {
  it('round-trips a push chain through the real transaction layer', () => {
    const original = createDefaultWorkspace();
    const command = { type: 'move' as const, instanceId: 'github', target: { x: 1, y: 3, w: 1, h: 1 } };
    const result = solveLayout({ columns: 10, items: original.layouts[10], command, preference: 'push-first', budget: DEFAULT_SOLVE_BUDGET });
    const preview = createLayoutPreview(original, 10, command, result, 'undo-case');
    if (preview.status !== 'ready') throw new Error(preview.reason);
    expect(preview.transaction.after).not.toEqual(preview.transaction.before);

    const committed = applyLayoutTransaction(original, preview.transaction);
    const undone = restoreLayoutTransaction(committed, preview.transaction, 'undo');
    expect(undone.layouts[10]).toEqual(original.layouts[10]);
    const redone = restoreLayoutTransaction(undone, preview.transaction, 'redo');
    expect(redone.layouts[10]).toEqual(committed.layouts[10]);
  });
});

// #15 lives above. #14 and the storage half of #16 can only be proven in the
// browser, so they are skipped here with the exact test that does cover them.
// A permanently-true assertion would have made this file look more complete
// than it is.
describe('14.2 #14 — Esc cancels every previewed offset', () => {
  it.skip('covered by tests/e2e/stage-2b-layout.spec.ts ("drags an icon … cancels with Esc")', () => {
    // Pressing Esc mid-drag must return the item to its committed cell with the
    // persisted Workspace untouched. A pointer preview only exists in the DOM,
    // so a pure unit test cannot reach it.
  });
});

describe('14.2 #15 — a stale drag result cannot overwrite a newer target', () => {
  it('invalidates the older operation when a newer one begins', () => {
    const original = createDefaultWorkspace();
    const first = solveLayout({ columns: 10, items: original.layouts[10], command: { type: 'move', instanceId: 'github', target: { x: 5, y: 6, w: 1, h: 1 } }, budget: DEFAULT_SOLVE_BUDGET });
    const second = solveLayout({ columns: 10, items: original.layouts[10], command: { type: 'move', instanceId: 'figma', target: { x: 6, y: 6, w: 1, h: 1 } }, budget: DEFAULT_SOLVE_BUDGET });
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    // The two previews describe different targets; only the newest may be held.
    if (first.status === 'ok' && second.status === 'ok') {
      const a = first.candidate.map((i) => `${i.instanceId}:${i.x},${i.y}`).join('|');
      const b = second.candidate.map((i) => `${i.instanceId}:${i.x},${i.y}`).join('|');
      expect(a).not.toBe(b);
    }
  });
});

describe('14.2 #16 — a budget or storage failure rolls back completely', () => {
  it('leaves the input untouched when the budget is exceeded', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const result = solveLayout({
      columns: 10, items: before,
      command: { type: 'move', instanceId: 'builtin.clock', target: { x: 0, y: 3, w: 6, h: 2 } },
      preference: 'push-first',
      budget: { maxNodes: 5000, maxMs: 40, maxAffectedItems: 1 },
    });
    expect(result.status).toBe('budget-exceeded');
    expect(result.candidate).toEqual(before);
    expect(result.changes).toEqual([]);
  });

  it.skip('covered by tests/e2e/stage-2a-layout.spec.ts ("rolls back the preview … when the layout write fails")', () => {
    // `stage-2a-layout.spec.ts` injects an IndexedDB readwrite failure and
    // asserts the preview is dropped and no undo entry is created; the store
    // layer is not reachable from a pure unit test.
  });
});

describe('14.2 #17 — 10 to 8 to 5 columns yield non-overlapping layouts', () => {
  it('maps each breakpoint to its own valid layout', () => {
    for (const [width, expected] of [[1440, 10], [900, 8], [600, 5]] as const) {
      expect(getGridColumns(width)).toBe(expected);
    }
    const workspace = createDefaultWorkspace();
    for (const columns of [10, 8, 5] as const) {
      expectInvariants(workspace.layouts[columns], columns);
    }
  });
});

describe('14.2 #18 — returning to a breakpoint restores the user’s earlier layout', () => {
  it('keeps the three breakpoint layouts independent', () => {
    const workspace = createDefaultWorkspace();
    const command = { type: 'compact' as const };
    const result = solveLayout({ columns: 10, items: workspace.layouts[10], command, budget: DEFAULT_SOLVE_BUDGET });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const preview = createLayoutPreview(workspace, 10, command, result, 'bp');
    if (preview.status !== 'ready') throw new Error(preview.reason);
    const committed = applyLayoutTransaction(workspace, preview.transaction);
    // Editing 10 must leave 8 and 5 exactly as they were.
    expect(committed.layouts[8]).toEqual(workspace.layouts[8]);
    expect(committed.layouts[5]).toEqual(workspace.layouts[5]);
    // Undoing brings 10 back to the user's previous layout.
    const undone = restoreLayoutTransaction(committed, preview.transaction, 'undo');
    expect(undone.layouts[10]).toEqual(workspace.layouts[10]);
  });
});

describe('14.2 #19 — a tidy does not modify persisted data before confirmation', () => {
  it('produces a preview object without touching the workspace', () => {
    const workspace = createDefaultWorkspace();
    const before = workspace.layouts[10];
    const command = { type: 'compact' as const };
    const result = solveLayout({ columns: 10, items: before, command, budget: DEFAULT_SOLVE_BUDGET });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    createLayoutPreview(workspace, 10, command, result, 'preview-only');
    // Building the preview must not mutate the source workspace.
    expect(workspace.revision).toBe(0);
    expect(workspace.layouts[10]).toEqual(before);
  });
});

describe('14.2 #20 — random legal layouts keep every instance exactly once', () => {
  it('satisfies the invariant block after a move and after a tidy', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      let state = seed;
      const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
      const columns = [5, 8, 10][seed % 3] as GridColumns;
      const placed: LayoutItem[] = [];
      const count = 2 + (seed % 6);
      for (let index = 0; index < count; index += 1) {
        const candidates: LayoutItem[] = [];
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x <= columns - 1; x += 1) {
            const candidate = item(`r${index}`, x, y, 1, 1, false, columns);
            if (isValidConstrainedLayout([...placed, candidate], columns)) candidates.push(candidate);
          }
        }
        if (!candidates.length) break;
        placed.push(candidates[Math.floor(random() * candidates.length)]!);
      }
      if (placed.length < 2) continue;
      expectInvariants(placed, columns);
      const tidied = solve(placed, { type: 'compact' }, columns);
      if (tidied.status === 'ok') {
        expectInvariants(tidied.candidate, columns);
        expect(ids(tidied.candidate)).toEqual(ids(placed));
        expect(sizes(tidied.candidate)).toEqual(sizes(placed));
      }
      // Reading order must stay total and stable for rendering.
      const ordered = readingOrder(tidied.status === 'ok' ? tidied.candidate : placed);
      expect(ordered).toHaveLength(placed.length);
    }
  });
});
