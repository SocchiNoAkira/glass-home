import { openDatabase, requestResult, transactionComplete, assetStore } from './database';
import { MAX_ASSET_BYTES, validateAssetImage } from '@/src/domain/workspace/schema';
import type { WorkspaceAsset } from '@/src/domain/workspace/model';

export async function validateImageFile(file: File): Promise<WorkspaceAsset> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG 或 WebP 图片。');
  if (file.size === 0 || file.size > MAX_ASSET_BYTES) throw new Error('图片需小于 4MB。');
  const blob = await validateAssetImage({ id: 'upload', mimeType: file.type as WorkspaceAsset['mimeType'], dataUrl: await blobToDataUrl(file) });
  return { id: crypto.randomUUID(), blob, mimeType: file.type as WorkspaceAsset['mimeType'], size: file.size, updatedAt: new Date().toISOString() };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(text)}`;
}

export class AssetRepository {
  private database: IDBDatabase | undefined;
  private async open(): Promise<IDBDatabase> { this.database ??= await openDatabase(); return this.database; }

  async put(asset: WorkspaceAsset): Promise<void> {
    const database = await this.open();
    const { transaction, store } = assetStore(database, 'readwrite');
    store.put(asset);
    await transactionComplete(transaction);
  }

  async get(id: string): Promise<WorkspaceAsset | undefined> {
    const database = await this.open();
    const { store } = assetStore(database, 'readonly');
    return await requestResult(store.get(id)) as WorkspaceAsset | undefined;
  }

  async remove(id: string): Promise<void> {
    const database = await this.open();
    const { transaction, store } = assetStore(database, 'readwrite');
    store.delete(id);
    await transactionComplete(transaction);
  }

  /**
   * Ids currently stored.
   *
   * Needed for orphan pruning: knowing which assets to delete requires knowing
   * what exists, and the reference set alone cannot reveal leftovers from
   * before a change. Uses `getAllKeys` so no blobs are materialised.
   */
  async listIds(): Promise<string[]> {
    const database = await this.open();
    const { store } = assetStore(database, 'readonly');
    const keys = await requestResult(store.getAllKeys()) as IDBValidKey[];
    return keys.map((key) => String(key));
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const { transaction, store } = assetStore(database, 'readwrite');
    store.clear();
    await transactionComplete(transaction);
  }

  close(): void { this.database?.close(); this.database = undefined; }
}
