import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { solveLayout } from '@/src/domain/grid/solver';
import { applyLayoutTransaction, createLayoutPreview, restoreLayoutTransaction } from '@/src/domain/layout/transaction';
import { LayoutHistory, LayoutPreviewCoordinator } from '@/src/application/layoutHistory';

function movePreview(workspace = createDefaultWorkspace()) {
  const command = { type: 'move' as const, instanceId: 'github', target: { x: 7, y: 2, w: 1, h: 1 } };
  const result = solveLayout({ columns: 10, items: workspace.layouts[10], command, preference: 'push-first', budget: { maxNodes: 5000, maxMs: 40, maxAffectedItems: 40 } });
  const preview = createLayoutPreview(workspace, 10, command, result, 'transaction-1');
  if (preview.status !== 'ready') throw new Error(preview.reason);
  return preview.transaction;
}

describe('layout transaction and history', () => {
  it('previews without mutating the saved Workspace, then commits one snapshot', () => {
    const workspace = createDefaultWorkspace();
    const transaction = movePreview(workspace);
    expect(workspace.layouts[10].find((item) => item.instanceId === 'github')).toMatchObject({ x: 0, y: 3 });
    expect(workspace.revision).toBe(0);
    const committed = applyLayoutTransaction(workspace, transaction);
    expect(committed.revision).toBe(1);
    expect(committed.layouts[8]).toEqual(workspace.layouts[8]);
    expect(committed.layouts[5]).toEqual(workspace.layouts[5]);
    expect(workspace.revision).toBe(0);
  });

  it('restores an entire push chain in one undo and redoes the whole result', () => {
    const original = createDefaultWorkspace();
    const transaction = movePreview(original);
    const committed = applyLayoutTransaction(original, transaction);
    const history = new LayoutHistory();
    history.record(transaction);
    const undone = restoreLayoutTransaction(committed, transaction, 'undo');
    history.completeUndo();
    expect(undone.layouts[10]).toEqual(original.layouts[10]);
    expect(undone.layouts[8]).toEqual(original.layouts[8]);
    expect(history.canRedo).toBe(true);
    const redone = restoreLayoutTransaction(undone, transaction, 'redo');
    history.completeRedo();
    expect(redone.layouts[10]).toEqual(committed.layouts[10]);
    expect(history.canUndo).toBe(true);
  });

  it('rejects stale commits and preserves entity data', () => {
    const original = createDefaultWorkspace();
    const transaction = movePreview(original);
    expect(() => applyLayoutTransaction({ ...original, revision: 2 }, transaction)).toThrow('过期');
    const committed = applyLayoutTransaction(original, transaction);
    expect(committed.shortcuts).toEqual(original.shortcuts);
    expect(committed.widgets).toEqual(original.widgets);
    expect(committed.settings).toEqual(original.settings);
  });

  it('drops redo after a new committed transaction', () => {
    const history = new LayoutHistory();
    const first = movePreview();
    history.record(first);
    history.completeUndo();
    expect(history.canRedo).toBe(true);
    history.record({ ...first, transactionId: 'second' });
    expect(history.canRedo).toBe(false);
    expect(history.undoCount).toBe(1);
  });

  it('invalidates an older target when a newer preview starts or is cancelled', () => {
    const coordinator = new LayoutPreviewCoordinator();
    const first = coordinator.begin(0, 'github:0:0');
    const second = coordinator.begin(0, 'figma:1:0');
    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    coordinator.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(second)).toBe(false);
  });
});
