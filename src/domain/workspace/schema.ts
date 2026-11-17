import { z } from 'zod';
import { GRID_BREAKPOINTS, isValidConstrainedLayout, type GridColumns } from '@/src/domain/grid/model';
import { validateShortcut } from '@/src/domain/shortcuts/shortcut';
import { validateSearchTemplate } from '@/src/domain/search/search';
import {
  BUILTIN_WIDGET_IDS,
  WIDGET_NAMESPACE_QUOTA_BYTES,
  WORKSPACE_SCHEMA_VERSION,
  type Workspace,
  type WorkspaceBackup,
} from './model';

const isoDate = z.iso.datetime();
const columns = z.union([z.literal(10), z.literal(8), z.literal(5)]);
const layoutItem = z.object({
  instanceId: z.string().min(1).max(160),
  kind: z.enum(['shortcut', 'widget']),
  breakpoint: columns,
  locked: z.boolean(),
  order: z.number().int().nonnegative(),
  groupId: z.string().max(100).optional(),
  x: z.number().int().nonnegative().max(1000),
  y: z.number().int().nonnegative().max(10000),
  w: z.number().int().min(1).max(10),
  h: z.number().int().min(1).max(8),
}).strict();
const shortcut = z.object({
  id: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(40),
  url: z.string().max(2048),
  icon: z.string().max(24),
  iconAssetId: z.string().max(160).optional(),
  openTarget: z.enum(['current', 'new']),
  accentColor: z.string().regex(/^#[\da-f]{6}$/i),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
const widgetInstance = z.object({
  instanceId: z.string().min(1).max(160),
  widgetId: z.string().min(1).max(160),
  widgetVersion: z.string().min(1).max(40),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  grantedPermissions: z.array(z.string().max(100)).max(30),
  storageNamespace: z.string().min(1).max(200),
  lastRefreshAt: isoDate.optional(),
  errorState: z.string().max(200).optional(),
}).strict();
const settings = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  materialQuality: z.enum(['high', 'balanced', 'low', 'off']),
  reducedMotion: z.boolean(),
  searchEngine: z.enum(['google', 'bing', 'baidu', 'duckduckgo', 'custom']),
  customSearchTemplate: z.string().max(2048),
  openTarget: z.enum(['current', 'new']),
  timeFormat: z.enum(['system', '12h', '24h']),
  timeZone: z.string().max(100),
  showSeconds: z.boolean(),
  showDate: z.boolean(),
  showWeekday: z.boolean(),
  calendarMode: z.enum(['compact', 'month']),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  wallpaperGradient: z.enum(['dawn', 'dusk', 'sage']),
  wallpaperAssetId: z.string().max(160).nullable(),
  wallpaperBlur: z.number().int().min(0).max(30),
  wallpaperOverlay: z.number().int().min(0).max(70),
}).strict();
const workspace = z.object({
  schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
  workspaceId: z.string().min(1).max(160),
  revision: z.number().int().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
  settings,
  layouts: z.object({ '10': z.array(layoutItem).max(300), '8': z.array(layoutItem).max(300), '5': z.array(layoutItem).max(300) }).strict(),
  shortcuts: z.array(shortcut).max(200),
  widgets: z.array(widgetInstance).max(100),
  installedWidgets: z.array(z.object({ widgetId: z.string().max(160), version: z.string().max(40) }).strict()).max(100),
}).strict();

export const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const imageMime = z.enum(['image/png', 'image/jpeg', 'image/webp']);
/**
 * Widget data stays a *string* payload: storage holds exactly that text, so an
 * import cannot silently re-shape the user's records by parsing and
 * re-serialising them.
 */
const widgetRecord = z.object({
  namespace: z.string().min(1).max(200),
  key: z.string().min(1).max(400),
  payload: z.string().min(2).max(WIDGET_NAMESPACE_QUOTA_BYTES),
  updatedAt: isoDate,
}).strict();
const backupSchema = z.object({
  format: z.literal('glass-home-backup'), version: z.literal(1), exportedAt: isoDate,
  workspace,
  assets: z.array(z.object({ id: z.string().min(1).max(160), mimeType: imageMime, dataUrl: z.string().max(6 * 1024 * 1024) }).strict()).max(210),
  widgetData: z.array(widgetRecord).max(1000).optional(),
}).strict();

function isValidTimeZone(value: string): boolean {
  if (value === 'system') return true;
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(); return true; } catch { return false; }
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateWorkspace(value: unknown): Workspace {
  const candidate = workspace.parse(value);
  const shortcutIds = candidate.shortcuts.map((item) => item.id);
  const widgetIds = candidate.widgets.map((item) => item.instanceId);
  if (!unique(shortcutIds) || !unique(widgetIds)) throw new Error('实例 ID 不能重复。');
  if (shortcutIds.some((id) => widgetIds.includes(id))) throw new Error('快捷方式与组件不能使用相同实例 ID。');
  for (const item of candidate.shortcuts) {
    const error = validateShortcut(item.title, item.url);
    if (error) throw new Error(error);
  }
  if (!isValidTimeZone(candidate.settings.timeZone)) throw new Error('时区设置无效。');
  if (candidate.settings.searchEngine === 'custom') {
    const error = validateSearchTemplate(candidate.settings.customSearchTemplate);
    if (error) throw new Error(error);
  }

  /*
   * Widgets are removable now, so a workspace is no longer required to carry
   * every built-in type: `[]` is a legitimate home screen. What must still hold
   * is the pairing between declarations and instances — an instance whose type
   * was never declared would have no known implementation, and two instances
   * sharing a storage namespace would read and clear each other's data.
   */
  const expectedIds = [...shortcutIds, ...widgetIds];
  for (const widget of candidate.widgets) {
    if (!BUILTIN_WIDGET_IDS.includes(widget.widgetId as (typeof BUILTIN_WIDGET_IDS)[number])) {
      throw new Error('此版本只能导入已支持的内置组件，不能导入可执行第三方组件。');
    }
    if (!candidate.installedWidgets.some((declared) => declared.widgetId === widget.widgetId)) {
      throw new Error(`缺少内置组件声明：${widget.widgetId}`);
    }
  }
  if (!unique(candidate.widgets.map((widget) => widget.storageNamespace))) {
    throw new Error('组件数据命名空间不能重复。');
  }
  for (const breakpoint of GRID_BREAKPOINTS) {
    const items = candidate.layouts[breakpoint];
    const ids = items.map((item) => item.instanceId);
    if (!isValidConstrainedLayout(items, breakpoint)) throw new Error(`${breakpoint} 列布局或尺寸不合法。`);
    if (ids.length !== expectedIds.length || !expectedIds.every((id) => ids.includes(id))) {
      throw new Error(`${breakpoint} 列布局与实例数据不完整。`);
    }
    for (const item of items) {
      const correctKind = shortcutIds.includes(item.instanceId) ? 'shortcut' : 'widget';
      if (item.kind !== correctKind) throw new Error('布局对象类型与实例不匹配。');
    }
  }
  return candidate;
}

export function validateBackup(value: unknown): WorkspaceBackup {
  const candidate = backupSchema.parse(value);
  validateWorkspace(candidate.workspace);
  const referenced = new Set([
    candidate.workspace.settings.wallpaperAssetId,
    ...candidate.workspace.shortcuts.map((shortcut) => shortcut.iconAssetId),
  ].filter((id): id is string => Boolean(id)));
  const ids = candidate.assets.map((asset) => asset.id);
  if (!unique(ids)) throw new Error('备份中的资源 ID 不能重复。');
  if (!ids.every((id) => referenced.has(id)) || !referenced.isSubsetOf(new Set(ids))) {
    throw new Error('备份图片与 Workspace 引用不一致，请重新导出。');
  }

  for (const asset of candidate.assets) {
    const prefix = `data:${asset.mimeType};base64,`;
    if (!asset.dataUrl.startsWith(prefix)) throw new Error('图片资源编码或类型不匹配。');
    const base64 = asset.dataUrl.slice(prefix.length);
    if (!/^[a-z\d+/]*={0,2}$/i.test(base64) || base64.length % 4 !== 0) throw new Error('图片资源不是有效的 Base64。');
    if (Math.floor(base64.length * 3 / 4) > MAX_ASSET_BYTES) throw new Error('单张图片不能超过 4MB。');
  }
  // `undefined` must survive validation: it is the signal "this backup predates
  // the widget-data field", and the importer uses it to leave existing widget
  // rows alone instead of wiping them.
  return {
    ...candidate,
    ...(candidate.widgetData === undefined ? {} : { widgetData: validateWidgetData(candidate.workspace, candidate.widgetData) }),
  };
}

/**
 * Widget data has one rule that matters more than any other: a backup must not
 * be able to *inject* data into a namespace the workspace does not declare.
 * Every namespace therefore has to belong to an instance in `workspace.widgets`,
 * which is also the set of namespaces the "clear one widget" action can address.
 */
function validateWidgetData(
  workspace: Workspace,
  widgetData: WorkspaceBackup['widgetData'],
): NonNullable<WorkspaceBackup['widgetData']> {
  if (!widgetData?.length) return [];
  const declared = new Set(workspace.widgets.map((widget) => widget.storageNamespace));
  const seen = new Set<string>();
  const bytesPerNamespace = new Map<string, number>();

  for (const record of widgetData) {
    if (!declared.has(record.namespace)) {
      throw new Error(`备份包含未声明的组件数据命名空间：${record.namespace}`);
    }
    // The stored key is `${namespace}:${localKey}`, so re-adding a prefix here
    // would produce a record no reader ever looks up.
    if (record.key.includes(record.namespace + ':')) throw new Error('组件数据的键不能包含命名空间前缀。');
    const identity = `${record.namespace}\u0000${record.key}`;
    if (seen.has(identity)) throw new Error('备份中的组件数据不能重复。');
    seen.add(identity);

    const bytes = payloadBytesOf(record.payload);
    const total = (bytesPerNamespace.get(record.namespace) ?? 0) + bytes;
    if (total > WIDGET_NAMESPACE_QUOTA_BYTES) {
      throw new Error(`组件数据超出单个组件配额（${WIDGET_NAMESPACE_QUOTA_BYTES} 字节）。`);
    }
    bytesPerNamespace.set(record.namespace, total);

    // Storing unparseable text would surface later as a silently empty widget.
    try { JSON.parse(record.payload); } catch { throw new Error('组件数据不是有效的 JSON。'); }
  }
  return widgetData;
}

function payloadBytesOf(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

export async function validateAssetImage(asset: WorkspaceBackup['assets'][number]): Promise<Blob> {
  const response = await fetch(asset.dataUrl);
  const blob = await response.blob();
  if (blob.type !== asset.mimeType || blob.size === 0 || blob.size > MAX_ASSET_BYTES) throw new Error('图片资源大小或类型不符合要求。');
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width > 6000 || bitmap.height > 6000 || bitmap.width * bitmap.height > 24_000_000) {
    bitmap.close();
    throw new Error('图片像素尺寸过大，请选择 2400 万像素以内的图片。');
  }
  bitmap.close();
  return blob;
}

export function isGridColumns(value: number): value is GridColumns {
  return GRID_BREAKPOINTS.includes(value as GridColumns);
}
