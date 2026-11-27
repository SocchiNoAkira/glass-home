import type { GridColumns } from '@/src/domain/grid/model';
import { BUILTIN_WIDGET_IDS, type WidgetInstance } from '@/src/domain/workspace/model';

/** One widget the gallery can put on the home screen. */
export type BuiltinWidgetId = (typeof BUILTIN_WIDGET_IDS)[number];

export interface WidgetCatalogEntry {
  readonly widgetId: BuiltinWidgetId;
  readonly label: string;
  readonly description: string;
  /**
   * Footprint used when the widget is added, per breakpoint.
   *
   * These all sit inside `BUILTIN_SIZE_CONSTRAINTS`, otherwise the candidate
   * would fail the layout validator at the end of the command. They are also
   * what the default screen already uses, so an added widget looks like the one
   * a fresh workspace ships with.
   */
  readonly footprint: Readonly<Record<GridColumns, { readonly w: number; readonly h: number }>>;
}

/**
 * The only widgets this build can put on the screen.
 *
 * One instance per type: the to-do widget's data lives under a namespace named
 * after the widget id, so a second instance would silently share the first
 * one's list. The gallery therefore offers "add" only while the type is absent,
 * and shows "已在主屏幕" otherwise.
 */
export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  {
    widgetId: 'builtin.clock',
    label: '时钟',
    description: '大号时间、日期与问候语。',
    footprint: { 10: { w: 4, h: 2 }, 8: { w: 4, h: 2 }, 5: { w: 4, h: 2 } },
  },
  {
    widgetId: 'builtin.search',
    label: '搜索',
    description: '搜索框与直接网址输入。',
    footprint: { 10: { w: 6, h: 1 }, 8: { w: 6, h: 1 }, 5: { w: 5, h: 1 } },
  },
  {
    widgetId: 'builtin.calendar',
    label: '日历',
    description: '日期，可切换为整月视图。',
    footprint: { 10: { w: 2, h: 2 }, 8: { w: 2, h: 2 }, 5: { w: 2, h: 2 } },
  },
  {
    widgetId: 'builtin.todo',
    label: '待办',
    description: '本地清单，回车添加，离线可用。',
    footprint: { 10: { w: 3, h: 2 }, 8: { w: 3, h: 2 }, 5: { w: 3, h: 2 } },
  },
  {
    widgetId: 'builtin.reminder',
    label: '提醒事项',
    description: '设定时间与内容，到点发出浏览器提醒。',
    footprint: { 10: { w: 3, h: 2 }, 8: { w: 3, h: 2 }, 5: { w: 3, h: 2 } },
  },
];

export function isBuiltinWidgetId(value: string): value is BuiltinWidgetId {
  return (BUILTIN_WIDGET_IDS as readonly string[]).includes(value);
}

export function widgetCatalogEntry(widgetId: string): WidgetCatalogEntry | undefined {
  return WIDGET_CATALOG.find((entry) => entry.widgetId === widgetId);
}

/**
 * Instance record for a widget that is being added.
 *
 * The storage namespace is the widget id, matching what the default workspace
 * and the v2 migration produce. Keeping one convention means a widget removed
 * and re-added addresses the same rows as before it was removed.
 */
export function createWidgetInstance(widgetId: BuiltinWidgetId): WidgetInstance {
  return {
    instanceId: widgetId,
    widgetId,
    widgetVersion: '1.0.0',
    enabled: true,
    settings: {},
    grantedPermissions: [],
    storageNamespace: widgetId,
  };
}
