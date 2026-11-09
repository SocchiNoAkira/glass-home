import { GRID_BREAKPOINTS, findFirstFit, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
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
    const add = (instanceId: string, x: number, y: number, w: number, h: number, order: number) => {
      rows.push({ instanceId, kind: 'shortcut', breakpoint: columns, locked: false, order, x, y, w, h });
    };
    // The three original builtins keep exactly the cells they had in stage 2A.
    // Moving them would change the accepted default composition.
    if (columns === 10) {
      add('builtin.clock', 0, 0, 6, 2, 0);
      add('builtin.calendar', 6, 0, 4, 2, 1);
      add('builtin.search', 0, 2, 6, 1, 2);
    } else if (columns === 8) {
      add('builtin.clock', 0, 0, 4, 2, 0);
      add('builtin.calendar', 4, 0, 4, 2, 1);
      add('builtin.search', 0, 2, 6, 1, 2);
    } else {
      add('builtin.clock', 0, 0, 5, 2, 0);
      add('builtin.search', 0, 2, 5, 1, 1);
      add('builtin.calendar', 0, 3, 4, 2, 2);
    }
    const firstShortcutRow = columns === 5 ? 5 : 3;
    shortcuts.forEach((shortcut, index) => {
      add(shortcut.id, index % columns, firstShortcutRow + Math.floor(index / columns), 1, 1, index + 3);
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

/** Default to-do footprint; the grid constraints allow 2x2, 4x2 and 4x4. */
const TODO_DEFAULT_FOOTPRINT = { w: 2, h: 2 } as const;

function placeTodo(items: readonly LayoutItem[], columns: GridColumns): { x: number; y: number; w: number; h: number } {
  const size = { w: Math.min(TODO_DEFAULT_FOOTPRINT.w, columns), h: TODO_DEFAULT_FOOTPRINT.h };
  const spot = findFirstFit(items, size, columns);
  // `findFirstFit` scans one row past the content, so this always resolves on
  // an otherwise legal layout; the fallback keeps the type non-optional.
  return spot ? { ...spot, ...size } : { x: 0, y: 0, ...size };
}

export function createDefaultWorkspace(now = new Date().toISOString()): Workspace {
  const shortcuts = createDefaultShortcuts(now);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaceId: DEFAULT_WORKSPACE_ID,
    revision: 0, createdAt: now, updatedAt: now, settings: DEFAULT_SETTINGS,
    layouts: createDefaultLayouts(shortcuts), shortcuts, widgets: createBuiltinWidgets(),
    installedWidgets: BUILTIN_WIDGET_IDS.map((widgetId) => ({ widgetId, version: '1.0.0' })),
  };
}
