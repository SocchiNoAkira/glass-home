import { GRID_BREAKPOINTS, findFirstFit, isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout } from '@/src/domain/grid/solver';
import { createWidgetInstance, widgetCatalogEntry, type BuiltinWidgetId } from '@/src/domain/widget/catalog';
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

/**
 * Puts one built-in widget on the screen.
 *
 * Placement is per breakpoint and independent: the three layouts are separate
 * documents, so the widget gets the first legal free spot in each rather than
 * trying to mirror one position onto grids of different widths. `findFirstFit`
 * scans one row past the content, so a full page grows a row instead of failing.
 *
 * `installedWidgets` keeps the declaration of the type, not of the instance: a
 * removed widget stays "installed" (its implementation is in this build), and
 * the validator only requires that every present instance is declared.
 */
export function addWidget(workspace: Workspace, widgetId: BuiltinWidgetId): Workspace {
  if (workspace.widgets.some((widget) => widget.widgetId === widgetId)) {
    throw new Error('这个小组件已经在主屏幕上了。');
  }
  const entry = widgetCatalogEntry(widgetId);
  if (!entry) throw new Error('找不到这个小组件的实现。');

  const layouts = {} as Record<GridColumns, readonly LayoutItem[]>;
  for (const columns of GRID_BREAKPOINTS) {
    const items = workspace.layouts[columns];
    const size = entry.footprint[columns];
    const spot = findFirstFit(items, size, columns);
    if (!spot) throw new Error(`${columns} 列网格里没有能放下这个小组件的位置。`);
    layouts[columns] = [...items, {
      instanceId: widgetId,
      kind: 'widget',
      breakpoint: columns,
      locked: false,
      order: items.length,
      x: spot.x,
      y: spot.y,
      w: size.w,
      h: size.h,
    }];
  }

  return commitCandidate(workspace, {
    ...workspace,
    layouts,
    widgets: [...workspace.widgets, createWidgetInstance(widgetId)],
    installedWidgets: workspace.installedWidgets.some((widget) => widget.widgetId === widgetId)
      ? workspace.installedWidgets
      : [...workspace.installedWidgets, { widgetId, version: '1.0.0' }],
  });
}

/**
 * Takes one widget off the screen.
 *
 * Only the instance and its three layout items go away; the type stays declared
 * in `installedWidgets` so the gallery can offer it again. Stored widget data is
 * cleared by the caller (the store owns storage), which is what makes "remove
 * then re-add" start from an empty list instead of silently resurrecting rows
 * no visible widget accounts for.
 */
export function removeWidget(workspace: Workspace, instanceId: string): Workspace {
  if (!workspace.widgets.some((widget) => widget.instanceId === instanceId)) return workspace;
  return commitCandidate(workspace, {
    ...workspace,
    widgets: workspace.widgets.filter((widget) => widget.instanceId !== instanceId),
    layouts: {
      10: workspace.layouts[10].filter((item) => item.instanceId !== instanceId),
      8: workspace.layouts[8].filter((item) => item.instanceId !== instanceId),
      5: workspace.layouts[5].filter((item) => item.instanceId !== instanceId),
    },
  });
}
