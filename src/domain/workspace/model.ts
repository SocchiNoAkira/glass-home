import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';

/**
 * Bytes one widget namespace may occupy (baseline 10.x quota).
 *
 * Declared here rather than in the persistence layer so the backup validator
 * and the storage writer agree on the same limit without the domain importing
 * infrastructure.
 */
export const WIDGET_NAMESPACE_QUOTA_BYTES = 256 * 1024;

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
  /** Kept for backup compatibility; the calendar always renders the month view. */
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

/**
 * One durable widget record inside a backup.
 *
 * The payload stays a JSON *string* rather than a nested object: storage keeps
 * exactly that text, so a round trip cannot reshape (and therefore re-measure)
 * a user's data, and the quota check on import applies to the same bytes.
 */
export interface WorkspaceBackupWidgetRecord {
  readonly namespace: string;
  readonly key: string;
  readonly payload: string;
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
  /**
   * Per-instance widget data (baseline 14.3 requires a backup to restore it).
   *
   * Optional so a backup exported before this field existed still imports: an
   * absent value means "this backup carries no widget data", which is exactly
   * what an older file contained. `| undefined` is explicit because the project
   * runs with `exactOptionalPropertyTypes`, where "absent" and "present but
   * undefined" are different types and the importer distinguishes them.
   */
  readonly widgetData?: readonly WorkspaceBackupWidgetRecord[] | undefined;
}
