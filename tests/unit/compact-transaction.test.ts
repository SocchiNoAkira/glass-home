import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { solveLayout, DEFAULT_SOLVE_BUDGET } from '@/src/domain/grid/solver';
import { applyLayoutTransaction, createLayoutPreview, restoreLayoutTransaction } from '@/src/domain/layout/transaction';
import { LayoutHistory } from '@/src/application/layoutHistory';
import { layoutHeight } from '@/src/domain/grid/occupancy';

/**
 * The tidy command goes through the same transaction gate as a move. These
 * tests pin that down explicitly instead of relying on the branch that happens
 * to exclude `compact`: a future command added to the union must not silently
 * inherit the "sizes may change" exemption.
 */

function compactPreview(workspace = createDefaultWorkspace(), breakpoint: 10 | 8 | 5 = 10) {
  const command = { type: 'compact' as const };
  const result = solveLayout({
    columns: breakpoint, items: workspace.layouts[breakpoint], command, budget: DEFAULT_SOLVE_BUDGET,
  });
  return { command, result };
}

describe('compact transaction gate', () => {
  it('accepts a tidy as one transaction that only touches the current breakpoint', () => {
    const workspace = createDefaultWorkspace();
    const { command, result } = compactPreview(workspace);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const preview = createLayoutPreview(workspace, 10, command, result, 'compact-1');
    if (preview.status !== 'ready') throw new Error(preview.reason);

    // Nothing is written until the transaction is applied.
    expect(workspace.revision).toBe(0);
    expect(workspace.layouts[10]).toEqual(createDefaultWorkspace().layouts[10]);

    const committed = applyLayoutTransaction(workspace, preview.transaction);
    expect(committed.revision).toBe(1);
    // Baseline 6.11: a tidy writes only the current breakpoint.
    expect(committed.layouts[8]).toEqual(workspace.layouts[8]);
    expect(committed.layouts[5]).toEqual(workspace.layouts[5]);
    // 14.2 #11: entity data is untouched.
    expect(committed.shortcuts).toEqual(workspace.shortcuts);
    expect(committed.widgets).toEqual(workspace.widgets);
    expect(committed.settings).toEqual(workspace.settings);
  });

  it('can be undone and redone as a single history entry', () => {
    const original = createDefaultWorkspace();
    const { command, result } = compactPreview(original);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const preview = createLayoutPreview(original, 10, command, result, 'compact-undo');
    if (preview.status !== 'ready') throw new Error(preview.reason);

    const committed = applyLayoutTransaction(original, preview.transaction);
    const history = new LayoutHistory();
    history.record(preview.transaction);
    expect(history.undoCount).toBe(1);

    const undone = restoreLayoutTransaction(committed, preview.transaction, 'undo');
    history.completeUndo();
    expect(undone.layouts[10]).toEqual(original.layouts[10]);
    expect(history.canRedo).toBe(true);

    const redone = restoreLayoutTransaction(undone, preview.transaction, 'redo');
    history.completeRedo();
    expect(redone.layouts[10]).toEqual(committed.layouts[10]);
  });

  it('rejects a transaction that tries to resize during a tidy', () => {
    const workspace = createDefaultWorkspace();
    const items = workspace.layouts[10];
    // A hand-made "tidy" that shrinks an object must fail the gate: tidy is
    // not a resize command, so no size change is allowed.
    const grown = items.map((item) => item.instanceId === 'github' ? { ...item, w: 2, h: 2 } : item);
    const transaction = {
      transactionId: 'bad-compact', breakpoint: 10 as const,
      baseRevision: workspace.revision, nextRevision: workspace.revision + 1,
      before: [...items], after: grown,
      command: { type: 'compact' as const }, operation: 'compact', createdAt: new Date().toISOString(),
    };
    expect(() => applyLayoutTransaction(workspace, transaction)).toThrow(/尺寸/);
  });

  it('rejects a transaction that moves a locked object during a tidy', () => {
    const base = createDefaultWorkspace();
    const items = base.layouts[10].map((item) =>
      item.instanceId === 'calendar' ? item : item);
    const workspace = { ...base, layouts: { ...base.layouts, 10: items } };
    const lockedItems = items.map((item) => item.instanceId === 'builtin.calendar' ? { ...item, locked: true } : item);
    const movedLocked = lockedItems.map((item) => item.instanceId === 'builtin.calendar' ? { ...item, x: 0, y: 6 } : item);
    const transaction = {
      transactionId: 'locked-compact', breakpoint: 10 as const,
      baseRevision: workspace.revision, nextRevision: workspace.revision + 1,
      before: [...lockedItems], after: movedLocked,
      command: { type: 'compact' as const }, operation: 'compact', createdAt: new Date().toISOString(),
    };
    expect(() => applyLayoutTransaction({ ...workspace, layouts: { ...workspace.layouts, 10: lockedItems } }, transaction)).toThrow(/锁定/);
  });

  it('reports a blocked preview when the layout is already compact', () => {
    // The default 10-column layout is already dense, so a tidy may be a no-op.
    const workspace = createDefaultWorkspace();
    const { command, result } = compactPreview(workspace);
    if (result.status !== 'ok' || result.changes.length > 0) return;
    const preview = createLayoutPreview(workspace, 10, command, result, 'noop');
    expect(preview.status).toBe('blocked');
  });

  it('does not make the page taller on the real default layout', () => {
    const workspace = createDefaultWorkspace();
    for (const columns of [10, 8, 5] as const) {
      const { result } = compactPreview(workspace, columns);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') continue;
      expect(layoutHeight(result.candidate)).toBeLessThanOrEqual(layoutHeight(workspace.layouts[columns]));
    }
  });
});
