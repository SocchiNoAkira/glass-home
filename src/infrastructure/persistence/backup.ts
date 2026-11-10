import type { WorkspaceAsset, WorkspaceBackup, WorkspaceBackupWidgetRecord } from '@/src/domain/workspace/model';
import { MAX_BACKUP_BYTES, validateBackup, validateAssetImage } from '@/src/domain/workspace/schema';
import { AssetRepository, blobToDataUrl } from './assetRepository';
import type { WidgetStorage } from './widgetStorage';

/**
 * Local backup: settings, layouts, shortcuts, images **and** widget data
 * (baseline 14.3). Widget data used to be missing here, which made a restored
 * backup silently lose every to-do item.
 */

const MISSING_ASSET = '备份所需的图片资源缺失，请重新选择图片后再导出。';

export async function readBackupFile(file: File): Promise<WorkspaceBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 12MB。');
  const text = await file.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('备份不是有效的 JSON 文件。'); }
  return validateBackup(parsed);
}

export async function decodeBackupAssets(backup: WorkspaceBackup): Promise<WorkspaceAsset[]> {
  const updatedAt = new Date().toISOString();
  const assets: WorkspaceAsset[] = [];
  for (const asset of backup.assets) {
    const blob = await validateAssetImage(asset);
    assets.push({ id: asset.id, blob, mimeType: asset.mimeType, size: blob.size, updatedAt });
  }
  return assets;
}

/**
 * Widget data is deliberately *not* decoded here: `validateBackup` already
 * rejected unknown namespaces, duplicate keys and unparseable payloads, so the
 * records are carried through verbatim and written in the same transaction as
 * the workspace and its assets.
 *
 * Returns `undefined` for a backup without the field, which the importer treats
 * as "older file, keep the widget rows that already exist".
 */
export function backupWidgetRecords(backup: WorkspaceBackup): readonly WorkspaceBackupWidgetRecord[] | undefined {
  return backup.widgetData;
}

export async function exportBackup(
  workspace: WorkspaceBackup['workspace'],
  assetRepository: AssetRepository,
  widgetStorage: WidgetStorage,
): Promise<WorkspaceBackup> {
  /**
   * Assets are collected by *id*, de-duplicated.
   *
   * Two shortcuts may legitimately share one `iconAssetId` (duplicating a
   * shortcut copies the field verbatim). Exporting that reference twice produced
   * a backup with two rows of the same id, which the validator then rejected as
   * "资源 ID 不能重复" — so the app could export a file it could never import.
   * Deduplicating at the source makes every export satisfy the import rule.
   */
  const assetIds = [...new Set([
    workspace.settings.wallpaperAssetId,
    ...workspace.shortcuts.map((item) => item.iconAssetId),
  ].filter((id): id is string => Boolean(id)))];
  const assets = [];
  for (const id of assetIds) {
    const asset: WorkspaceAsset | undefined = await assetRepository.get(id);
    if (!asset) throw new Error(MISSING_ASSET);
    assets.push({ id: asset.id, mimeType: asset.mimeType, dataUrl: await blobToDataUrl(asset.blob) });
  }
  // Scoped to the namespaces the workspace declares: leftovers from an instance
  // the user already removed must not come back through an import.
  const namespaces = workspace.widgets.map((widget) => widget.storageNamespace);
  const widgetData = await widgetStorage.snapshot(namespaces);
  return { format: 'glass-home-backup', version: 1, exportedAt: new Date().toISOString(), workspace, assets, widgetData };
}

export function downloadBackup(backup: WorkspaceBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `glass-home-backup-${backup.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
