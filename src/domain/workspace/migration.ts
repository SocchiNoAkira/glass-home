import { GRID_BREAKPOINTS, findFirstFit, isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { TODO_WIDGET_ID, type WidgetInstance, type Workspace } from './model';

/**
 * Workspace schema migration, v1 -> v2.
 *
 * v2 adds the built-in to-do widget. The v1 validator requires every id in
 * `BUILTIN_WIDGET_IDS` to be present in all three breakpoints, so shipping the
 * widget without a migration would send every existing user into the recovery
 * screen on next load.
 *
 * The migration is deliberately additive: it only appends the new widget
 * instance and one layout item per breakpoint. Existing shortcuts, widget
 * instances, settings, assets and revision history are carried through
 * untouched, so a user who never wants the to-do widget can still remove it
 * manually afterwards.
 */

export const TODO_WIDGET_VERSION = '1.0.0';
export const TODO_DEFAULT_SIZE = { w: 2, h: 2 } as const;

/** Ids that existed before v2, in a stable order. */
export const V1_WIDGET_IDS = ['builtin.clock', 'builtin.search', 'builtin.calendar'] as const;

export type MigrationResult =
  | { readonly status: 'migrated'; readonly workspace: Workspace; readonly detail: string }
  | { readonly status: 'unchanged'; readonly workspace: Workspace; readonly detail: string };

function alreadyHasTodo(workspace: Workspace): boolean {
  const declared = workspace.widgets.some((widget) => widget.widgetId === TODO_WIDGET_ID);
  const layoutHasIt = GRID_BREAKPOINTS.every((columns) =>
    workspace.layouts[columns].some((item) => item.instanceId === TODO_WIDGET_ID));
  return declared && layoutHasIt;
}

function todoInstance(): WidgetInstance {
  return {
    instanceId: TODO_WIDGET_ID,
    widgetId: TODO_WIDGET_ID,
    widgetVersion: TODO_WIDGET_VERSION,
    enabled: true,
    settings: {},
    grantedPermissions: [],
    storageNamespace: TODO_WIDGET_ID,
  };
}

/** Places the to-do widget in the first free cell, growing a row if needed. */
function placeTodo(items: readonly LayoutItem[], columns: GridColumns, order: number): LayoutItem[] {
  const size = { w: Math.min(TODO_DEFAULT_SIZE.w, columns), h: TODO_DEFAULT_SIZE.h };
  const spot = findFirstFit(items, size, columns);
  // `findFirstFit` scans one row past the current content, so a full page still
  // yields a slot on the new row rather than failing the migration.
  if (!spot) return [...items];
  return [...items, {
    instanceId: TODO_WIDGET_ID,
    kind: 'widget',
    breakpoint: columns,
    locked: false,
    order,
    x: spot.x, y: spot.y, w: size.w, h: size.h,
  }];
}

export function migrateWorkspace(input: Workspace): MigrationResult {
  if (alreadyHasTodo(input)) {
    return { status: 'unchanged', workspace: input, detail: '工作区已包含待办组件，无需迁移。' };
  }

  const layouts = { ...input.layouts } as Record<GridColumns, readonly LayoutItem[]>;
  const problems: string[] = [];
  for (const columns of GRID_BREAKPOINTS) {
    const next = placeTodo(input.layouts[columns], columns, input.layouts[columns].length);
    // A placement that fails validation must not be written: leaving the
    // breakpoint untouched is safer than persisting an illegal layout.
    if (!isValidConstrainedLayout(next, columns)) {
      problems.push(`${columns} 列`);
      continue;
    }
    layouts[columns] = next;
  }
  if (problems.length > 0) {
    return {
      status: 'unchanged',
      workspace: input,
      detail: `无法为待办组件找到合法位置（${problems.join('、')}），已保留原布局。`,
    };
  }

  const next: Workspace = {
    ...input,
    schemaVersion: 2,
    revision: input.revision + 1,
    updatedAt: new Date().toISOString(),
    layouts,
    widgets: [...input.widgets, todoInstance()],
    installedWidgets: [...input.installedWidgets, { widgetId: TODO_WIDGET_ID, version: TODO_WIDGET_VERSION }],
  };
  return { status: 'migrated', workspace: next, detail: '已加入内置待办组件。' };
}

/**
 * Normalises any stored workspace to the current schema version.
 *
 * Unknown future versions are rejected rather than guessed at: silently
 * downgrading a v3 workspace would drop data the user cannot see.
 */
export function normalizeWorkspace(stored: unknown, currentVersion: number): { readonly ok: true; readonly workspace: unknown; readonly migrated: boolean } | { readonly ok: false; readonly reason: string } {
  if (typeof stored !== 'object' || stored === null) return { ok: false, reason: '本地数据不是有效的对象。' };
  const version = (stored as { schemaVersion?: unknown }).schemaVersion;
  if (version === currentVersion) return { ok: true, workspace: stored, migrated: false };
  if (version === 1 && currentVersion === 2) {
    const result = migrateWorkspace(stored as Workspace);
    return { ok: true, workspace: result.workspace, migrated: result.status === 'migrated' };
  }
  return { ok: false, reason: `不支持的工作区版本：${String(version)}。` };
}
