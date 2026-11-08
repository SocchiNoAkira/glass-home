import type { WorkspaceAsset, WorkspaceBackup } from '@/src/domain/workspace/model';
import { MAX_BACKUP_BYTES, validateBackup, validateAssetImage } from '@/src/domain/workspace/schema';
import { AssetRepository, blobToDataUrl } from './assetRepository';

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

export async function exportBackup(workspace: WorkspaceBackup['workspace'], assetRepository: AssetRepository): Promise<WorkspaceBackup> {
  const assetIds = [workspace.settings.wallpaperAssetId, ...workspace.shortcuts.map((item) => item.iconAssetId)].filter((id): id is string => Boolean(id));
  const assets = [];
  for (const id of assetIds) {
    const asset: WorkspaceAsset | undefined = await assetRepository.get(id);
    if (!asset) throw new Error('备份所需的图片资源缺失，请重新选择图片后再导出。');
    assets.push({ id: asset.id, mimeType: asset.mimeType, dataUrl: await blobToDataUrl(asset.blob) });
  }
  return { format: 'glass-home-backup', version: 1, exportedAt: new Date().toISOString(), workspace, assets };
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
