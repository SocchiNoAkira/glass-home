import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';
import type { LayoutCommand, SolveResult } from '@/src/domain/grid/solver';
import type { Workspace } from '@/src/domain/workspace/model';
import { validateWorkspace } from '@/src/domain/workspace/schema';

export interface LayoutTransaction {
  readonly transactionId: string;
  readonly breakpoint: GridColumns;
  readonly baseRevision: number;
  readonly nextRevision: number;
  readonly before: readonly LayoutItem[];
  readonly after: readonly LayoutItem[];
  readonly command: LayoutCommand;
  readonly operation: string;
  readonly createdAt: string;
}

export type LayoutPreview =
  | { readonly status: 'ready'; readonly transaction: LayoutTransaction }
  | { readonly status: 'blocked'; readonly reason: string };

export function createLayoutPreview(workspace: Workspace, breakpoint: GridColumns, command: LayoutCommand, result: SolveResult, transactionId: string, now = new Date().toISOString()): LayoutPreview {
  if (result.status !== 'ok') return { status: 'blocked', reason: result.reason };
  if (result.changes.length === 0) return { status: 'blocked', reason: '目标位置没有变化。' };
  const after = [...result.candidate];
  const transaction: LayoutTransaction = {
    transactionId, breakpoint, baseRevision: workspace.revision, nextRevision: workspace.revision + 1,
    before: [...workspace.layouts[breakpoint]], after, command, operation: result.operation, createdAt: now,
  };
  validateLayoutCandidate(workspace, transaction);
  return { status: 'ready', transaction };
}

export function validateLayoutCandidate(workspace: Workspace, transaction: LayoutTransaction): Workspace {
  if (transaction.command.type === 'set-lock') {
    for (const before of transaction.before) {
      const after = transaction.after.find((item) => item.instanceId === before.instanceId);
      if (after && (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h)) throw new Error('锁定操作不能移动对象。');
    }
  }
  const beforeIds = transaction.before.map((item) => item.instanceId);
  const afterIds = transaction.after.map((item) => item.instanceId);
  if (beforeIds.length !== afterIds.length || !beforeIds.every((id) => afterIds.includes(id))) throw new Error('布局事务不能丢失或新增未声明的实例。');
  const sizes = new Map(transaction.before.map((item) => [item.instanceId, item]));
  for (const item of transaction.after) {
    const previous = sizes.get(item.instanceId);
    if (!previous) throw new Error('布局事务中出现未知实例。');
    if (previous.locked && transaction.command.type !== 'set-lock' && (previous.x !== item.x || previous.y !== item.y || previous.w !== item.w || previous.h !== item.h)) throw new Error('自动操作不能移动锁定对象。');
    if (transaction.command.type !== 'resize' && transaction.command.type !== 'set-lock' && (previous.w !== item.w || previous.h !== item.h)) throw new Error('移动或推挤不能改变对象尺寸。');
    if (transaction.command.type === 'resize' && item.instanceId !== transaction.command.instanceId && (previous.w !== item.w || previous.h !== item.h)) throw new Error('推挤不能缩小受影响对象。');
  }
  return validateWorkspace({
    ...workspace, revision: transaction.nextRevision, updatedAt: transaction.createdAt,
    layouts: { ...workspace.layouts, [transaction.breakpoint]: transaction.after },
  });
}

export function applyLayoutTransaction(workspace: Workspace, transaction: LayoutTransaction): Workspace {
  if (transaction.baseRevision !== workspace.revision) throw new Error('工作区修订已变化，不能提交过期布局预览。');
  return validateLayoutCandidate(workspace, transaction);
}

export function restoreLayoutTransaction(workspace: Workspace, transaction: LayoutTransaction, direction: 'undo' | 'redo'): Workspace {
  const expected = direction === 'undo' ? transaction.after : transaction.before;
  const current = workspace.layouts[transaction.breakpoint];
  const currentIds = current.map((item) => item.instanceId);
  const expectedIds = expected.map((item) => item.instanceId);
  if (currentIds.length !== expectedIds.length || !expectedIds.every((id) => currentIds.includes(id))) {
    throw new Error('当前断点的实例已变化，不能自动恢复此布局；请先完成或撤销新增/删除操作。');
  }
  const layout = direction === 'undo' ? transaction.before : transaction.after;
  return validateWorkspace({ ...workspace, revision: workspace.revision + 1, updatedAt: new Date().toISOString(), layouts: { ...workspace.layouts, [transaction.breakpoint]: [...layout] } });
}
