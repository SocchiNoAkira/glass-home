import {
  DEFAULT_SOLVE_BUDGET, solveLayout,
  type LayoutCommand,
} from '@/src/domain/grid/solver';
import { GRID_BREAKPOINTS, findFirstFit, isValidConstrainedLayout, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { widgetCatalogEntry } from '@/src/domain/widget/catalog';
import { REMINDER_WIDGET_ID, TODO_WIDGET_ID, type WidgetInstance, type Workspace } from './model';

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
export const REMINDER_WIDGET_VERSION = '1.0.0';

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
  const size = widgetCatalogEntry(TODO_WIDGET_ID)?.footprint[columns] ?? { w: 3, h: 2 };
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

/** Built-ins whose preferred footprint changed after the initial release. */
const RESIZED_WIDGETS = ['builtin.clock', 'builtin.calendar', TODO_WIDGET_ID] as const;

function resizeWidgetInLayout(
  items: readonly LayoutItem[],
  columns: GridColumns,
  instanceId: string,
  target: { readonly w: number; readonly h: number },
): readonly LayoutItem[] | undefined {
  const current = items.find((item) => item.instanceId === instanceId);
  if (!current || (current.w === target.w && current.h === target.h)) return items;

  // A locked object still has to adopt the new footprint; its lock is restored
  // after the reflow so the migration does not quietly unlock user choices.
  const unlocked = current.locked
    ? items.map((item) => item.instanceId === instanceId ? { ...item, locked: false } : item)
    : items;
  const resizeAt = (x: number, y: number): LayoutCommand => ({
    type: 'resize', instanceId, target: { x, y, ...target },
  });

  let result = solveLayout({
    columns, items: unlocked, command: resizeAt(current.x, current.y),
    preference: 'push-first', budget: DEFAULT_SOLVE_BUDGET,
  });
  if (result.status !== 'ok') {
    const without = unlocked.filter((item) => item.instanceId !== instanceId);
    const spot = findFirstFit(without, { ...target, instanceId }, columns);
    if (spot) {
      result = solveLayout({
        columns, items: unlocked, command: resizeAt(spot.x, spot.y),
        preference: 'push-first', budget: DEFAULT_SOLVE_BUDGET,
      });
    }
  }
  if (result.status !== 'ok') return undefined;

  const candidate = result.candidate.map((item) =>
    item.instanceId === instanceId ? { ...item, locked: current.locked } : item);
  return isValidConstrainedLayout(candidate, columns) ? candidate : undefined;
}

/**
 * Brings saved widgets onto the current preferred footprints.
 *
 * This is deliberately not a schema-version bump: the old sizes stay legal in
 * the constraints, so backups and edited layouts remain importable, while a
 * stored screen is gently reflowed the next time it is loaded.
 */
export function normalizeWidgetFootprints(workspace: Workspace): { readonly workspace: Workspace; readonly changed: boolean } {
  const layouts = { ...workspace.layouts } as Record<GridColumns, readonly LayoutItem[]>;
  let changed = false;
  for (const columns of GRID_BREAKPOINTS) {
    let items = workspace.layouts[columns];
    for (const instanceId of RESIZED_WIDGETS) {
      const target = widgetCatalogEntry(instanceId)?.footprint[columns];
      if (!target) continue;
      const next = resizeWidgetInLayout(items, columns, instanceId, target);
      if (next && next !== items) {
        items = next;
        changed = true;
      }
    }
    layouts[columns] = items;
  }
  if (!changed) return { workspace, changed: false };
  return {
    workspace: {
      ...workspace, layouts,
      revision: workspace.revision + 1,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
  };
}

function reminderInstance(): WidgetInstance {
  return {
    instanceId: REMINDER_WIDGET_ID,
    widgetId: REMINDER_WIDGET_ID,
    widgetVersion: REMINDER_WIDGET_VERSION,
    enabled: true,
    settings: {},
    grantedPermissions: [],
    storageNamespace: REMINDER_WIDGET_ID,
  };
}

/**
 * Adds newly shipped built-ins without changing the schema version.
 *
 * The validator only requires declared widget instances to have matching
 * layouts, so old workspaces stay valid. This normaliser deliberately makes
 * the addition explicit: existing users get the new widget once, and a backup
 * from before the feature is upgraded on import instead of silently omitting it.
 */
export function normalizeBuiltinWidgets(workspace: Workspace): { readonly workspace: Workspace; readonly changed: boolean } {
  const declared = workspace.widgets.some((widget) => widget.widgetId === REMINDER_WIDGET_ID);
  const missing = GRID_BREAKPOINTS.filter((columns) =>
    !workspace.layouts[columns].some((item) => item.instanceId === REMINDER_WIDGET_ID));
  if (declared && missing.length === 0) return { workspace, changed: false };

  const layouts = { ...workspace.layouts } as Record<GridColumns, readonly LayoutItem[]>;
  for (const columns of missing) {
    const size = widgetCatalogEntry(REMINDER_WIDGET_ID)?.footprint[columns];
    if (!size) return { workspace, changed: false };
    const items = workspace.layouts[columns];
    const spot = findFirstFit(items, { ...size, instanceId: REMINDER_WIDGET_ID }, columns);
    if (!spot) return { workspace, changed: false };
    const candidate = [...items, {
      instanceId: REMINDER_WIDGET_ID,
      kind: 'widget' as const,
      breakpoint: columns,
      locked: false,
      order: items.length,
      ...spot,
      ...size,
    }];
    if (!isValidConstrainedLayout(candidate, columns)) return { workspace, changed: false };
    layouts[columns] = candidate;
  }

  return {
    workspace: {
      ...workspace,
      layouts,
      widgets: declared ? workspace.widgets : [...workspace.widgets, reminderInstance()],
      installedWidgets: workspace.installedWidgets.some((entry) => entry.widgetId === REMINDER_WIDGET_ID)
        ? workspace.installedWidgets
        : [...workspace.installedWidgets, { widgetId: REMINDER_WIDGET_ID, version: REMINDER_WIDGET_VERSION }],
      revision: workspace.revision + 1,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
  };
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
