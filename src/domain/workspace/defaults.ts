import { GRID_BREAKPOINTS, findFirstFit, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
import { widgetCatalogEntry } from '@/src/domain/widget/catalog';
import { SHORTCUT_SEEDS } from '@/src/features/home/data';
import {
  BUILTIN_WIDGET_IDS,
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_SCHEMA_VERSION,
  type Shortcut,
  type WidgetInstance,
  type Workspace,
  type WorkspaceSettings,
} from './model';

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  theme: 'dark', materialQuality: 'balanced', reducedMotion: false,
  searchEngine: 'google', customSearchTemplate: '', openTarget: 'new',
  timeFormat: '24h', timeZone: 'system', showSeconds: false, showDate: true, showWeekday: true,
  calendarMode: 'compact', weekStartsOn: 1,
  wallpaperGradient: 'dawn', wallpaperAssetId: null, wallpaperBlur: 0, wallpaperOverlay: 24,
};

export function createDefaultShortcuts(now = new Date().toISOString()): Shortcut[] {
  return SHORTCUT_SEEDS.map((seed) => ({
    id: seed.id, title: seed.name, url: seed.url, icon: seed.initials,
    openTarget: 'new', accentColor: seed.color, createdAt: now, updatedAt: now,
  }));
}

export function createBuiltinWidgets(): WidgetInstance[] {
  return BUILTIN_WIDGET_IDS.map((widgetId) => ({
    instanceId: widgetId, widgetId, widgetVersion: '1.0.0', enabled: true,
    settings: {}, grantedPermissions: [], storageNamespace: widgetId,
  }));
}

export function createDefaultLayouts(shortcuts: readonly Shortcut[]): Record<GridColumns, LayoutItem[]> {
  return Object.fromEntries(GRID_BREAKPOINTS.map((columns) => {
    const widgets = createBuiltinWidgets();
    const rows: LayoutItem[] = [];
    const sizeOf = (instanceId: string, kind: LayoutItem['kind']) =>
      kind === 'shortcut'
        ? { w: 1, h: 1 }
        : widgetCatalogEntry(instanceId)?.footprint[columns] ?? { w: 2, h: 2 };
    const add = (instanceId: string, kind: LayoutItem['kind'], x: number, y: number, order: number) => {
      rows.push({ instanceId, kind, breakpoint: columns, locked: false, order, x, y, ...sizeOf(instanceId, kind) });
    };

    if (columns === 5) {
      // A 4-column clock leaves no room beside the calendar, so the narrow
      // breakpoint stacks the calendar above the full-width search field.
      add('builtin.clock', 'widget', 0, 0, 0);
      add('builtin.calendar', 'widget', 0, 2, 1);
      add('builtin.search', 'widget', 0, 4, 2);
    } else {
      add('builtin.clock', 'widget', 0, 0, 0);
      add('builtin.calendar', 'widget', 4, 0, 1);
      add('builtin.search', 'widget', 0, 2, 2);
    }
    const firstShortcutRow = columns === 5 ? 5 : 3;
    shortcuts.forEach((shortcut, index) => {
      add(shortcut.id, 'shortcut', index % columns, firstShortcutRow + Math.floor(index / columns), index + 3);
    });

    // The to-do widget is appended into the first free cell *after* every
    // existing object, never in the middle of the accepted composition. The
    // stage 3 migration uses the same first-fit rule, so a fresh workspace and
    // an upgraded one end up with the widget in the same place.
    rows.push({
      instanceId: 'builtin.todo', kind: 'widget', breakpoint: columns,
      locked: false, order: rows.length,
      ...placeTodo(rows, columns),
    });

    return [columns, rows.map((item) => widgets.some((widget) => widget.instanceId === item.instanceId) ? { ...item, kind: 'widget' } : item)];
  })) as Record<GridColumns, LayoutItem[]>;
}

function placeTodo(items: readonly LayoutItem[], columns: GridColumns): { x: number; y: number; w: number; h: number } {
  const size = widgetCatalogEntry('builtin.todo')?.footprint[columns] ?? { w: 3, h: 2 };
  const spot = findFirstFit(items, size, columns);
  // `findFirstFit` scans one row past the content, so this always resolves on
  // an otherwise legal layout; the fallback keeps the type non-optional.
  return spot ? { ...spot, ...size } : { x: 0, y: 0, ...size };
}

function createWorkspace(shortcuts: readonly Shortcut[], now: string): Workspace {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaceId: DEFAULT_WORKSPACE_ID,
    revision: 0, createdAt: now, updatedAt: now, settings: DEFAULT_SETTINGS,
    layouts: createDefaultLayouts(shortcuts), shortcuts, widgets: createBuiltinWidgets(),
    installedWidgets: BUILTIN_WIDGET_IDS.map((widgetId) => ({ widgetId, version: '1.0.0' })),
  };
}

/** The screen a first install ships with: the 20 curated shortcuts. */
export function createDefaultWorkspace(now = new Date().toISOString()): Workspace {
  return createWorkspace(createDefaultShortcuts(now), now);
}

/**
 * A screen with the widgets but no shortcuts.
 *
 * Used when storage has to recreate a workspace after the first install (for
 * example after "clear all data"): the presets are a one-time starting point,
 * not something that reappears every time the screen is rebuilt. The widgets
 * stay because they are the product, not sample content — and they are
 * removable from the gallery if the user does not want them either.
 */
export function createBlankWorkspace(now = new Date().toISOString()): Workspace {
  return createWorkspace([], now);
}
