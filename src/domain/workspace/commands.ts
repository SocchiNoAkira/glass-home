import { isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout } from '@/src/domain/grid/solver';
import { validateWorkspace } from './schema';
import type { Shortcut, Workspace, WorkspaceSettings } from './model';

function commitCandidate(workspace: Workspace, candidate: Workspace): Workspace {
  validateWorkspace(candidate);
  return { ...candidate, revision: workspace.revision + 1, updatedAt: new Date().toISOString() };
}

export function updateSettings(workspace: Workspace, patch: Partial<WorkspaceSettings>): Workspace {
  return commitCandidate(workspace, { ...workspace, settings: { ...workspace.settings, ...patch } });
}

export function addShortcut(workspace: Workspace, shortcut: Shortcut): Workspace {
  const placeShortcut = (columns: GridColumns): readonly LayoutItem[] => {
    const items = workspace.layouts[columns];
    const item: LayoutItem = { instanceId: shortcut.id, kind: 'shortcut', breakpoint: columns, locked: false, order: items.length, x: 0, y: 0, w: 1, h: 1 };
    const result = solveLayout({ columns, items, command: { type: 'insert', item }, budget: DEFAULT_SOLVE_BUDGET });
    if (result.status !== 'ok') throw new Error(`${columns} 列网格中无法放置新图标：${result.reason}`);
    if (!isValidConstrainedLayout(result.candidate, columns)) throw new Error('新图标布局未通过碰撞检查。');
    return result.candidate;
  };
  const layouts: Workspace['layouts'] = {
    10: placeShortcut(10),
    8: placeShortcut(8),
    5: placeShortcut(5),
  };
  return commitCandidate(workspace, { ...workspace, shortcuts: [...workspace.shortcuts, shortcut], layouts });
}

export function updateShortcut(workspace: Workspace, shortcut: Shortcut): Workspace {
  return commitCandidate(workspace, {
    ...workspace,
    shortcuts: workspace.shortcuts.map((item) => item.id === shortcut.id ? shortcut : item),
  });
}

export function removeShortcut(workspace: Workspace, instanceId: string): Workspace {
  if (!workspace.shortcuts.some((item) => item.id === instanceId)) return workspace;
  return commitCandidate(workspace, {
    ...workspace,
    shortcuts: workspace.shortcuts.filter((item) => item.id !== instanceId),
    layouts: {
      10: workspace.layouts[10].filter((item) => item.instanceId !== instanceId),
      8: workspace.layouts[8].filter((item) => item.instanceId !== instanceId),
      5: workspace.layouts[5].filter((item) => item.instanceId !== instanceId),
    },
  });
}
