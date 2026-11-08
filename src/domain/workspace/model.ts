import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';

export const WORKSPACE_SCHEMA_VERSION = 2;
export const DEFAULT_WORKSPACE_ID = 'glass-home-workspace';
/** v2 adds the to-do widget, so stored v1 data must be migrated on load. */
export const TODO_WIDGET_ID = 'builtin.todo';
export const BUILTIN_WIDGET_IDS = ['builtin.clock', 'builtin.search', 'builtin.calendar', TODO_WIDGET_ID] as const;

export type MaterialQuality = 'high' | 'balanced' | 'low' | 'off';
export type ThemePreference = 'system' | 'light' | 'dark';
export type SearchEngine = 'google' | 'bing' | 'baidu' | 'duckduckgo' | 'custom';
export type OpenTarget = 'current' | 'new';
export type WallpaperGradient = 'dawn' | 'dusk' | 'sage';

export interface WorkspaceSettings {
  readonly theme: ThemePreference;
  readonly materialQuality: MaterialQuality;
  readonly reducedMotion: boolean;
  readonly searchEngine: SearchEngine;
  readonly customSearchTemplate: string;
  readonly openTarget: OpenTarget;
  readonly timeFormat: 'system' | '12h' | '24h';
  readonly timeZone: string;
  readonly showSeconds: boolean;
  readonly showDate: boolean;
  readonly showWeekday: boolean;
  readonly calendarMode: 'compact' | 'month';
  readonly weekStartsOn: 0 | 1;
  readonly wallpaperGradient: WallpaperGradient;
  readonly wallpaperAssetId: string | null;
  readonly wallpaperBlur: number;
  readonly wallpaperOverlay: number;
}

export interface Shortcut {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly icon: string;
  readonly iconAssetId?: string | undefined;
  readonly openTarget: OpenTarget;
  readonly accentColor: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WidgetInstance {
  readonly instanceId: string;
  readonly widgetId: (typeof BUILTIN_WIDGET_IDS)[number] | (string & {});
  readonly widgetVersion: string;
  readonly enabled: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly grantedPermissions: readonly string[];
  readonly storageNamespace: string;
  readonly lastRefreshAt?: string | undefined;
  readonly errorState?: string | undefined;
}

export interface Workspace {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: WorkspaceSettings;
  readonly layouts: Readonly<Record<GridColumns, readonly LayoutItem[]>>;
  readonly shortcuts: readonly Shortcut[];
  readonly widgets: readonly WidgetInstance[];
  readonly installedWidgets: readonly { widgetId: string; version: string }[];
}

export interface WorkspaceAsset {
  readonly id: string;
  readonly blob: Blob;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly size: number;
  readonly updatedAt: string;
}

export interface WorkspaceBackup {
  readonly format: 'glass-home-backup';
  readonly version: 1;
  readonly exportedAt: string;
  readonly workspace: Workspace;
  readonly assets: readonly {
    readonly id: string;
    readonly mimeType: WorkspaceAsset['mimeType'];
    readonly dataUrl: string;
  }[];
}
