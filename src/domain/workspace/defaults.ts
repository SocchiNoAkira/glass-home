import { GRID_BREAKPOINTS, type GridColumns, type LayoutItem } from '@/src/domain/grid/model';
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
    return [columns, rows.map((item) => widgets.some((widget) => widget.instanceId === item.instanceId) ? { ...item, kind: 'widget' } : item)];
  })) as Record<GridColumns, LayoutItem[]>;
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
