import { z } from 'zod';
import { openDatabase, requestResult, transactionComplete, workspaceStore } from './database';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION, type Workspace, type WorkspaceAsset } from '@/src/domain/workspace/model';
import { normalizeWorkspace } from '@/src/domain/workspace/migration';
import { validateWorkspace } from '@/src/domain/workspace/schema';

export type LoadWorkspaceResult =
  | { status: 'ready'; workspace: Workspace; migrated?: boolean }
  | { status: 'recovery-required'; message: string };

function storageError(error: unknown): Error {
  return error instanceof Error ? error : new Error('本地存储操作失败。');
}

export class WorkspaceRepository {
  private database: IDBDatabase | undefined;
  private writeQueue: Promise<unknown> = Promise.resolve();

  private async open(): Promise<IDBDatabase> {
    this.database ??= await openDatabase();
    return this.database;
  }

  async load(): Promise<LoadWorkspaceResult> {
    const database = await this.open();
    const { store } = workspaceStore(database, 'readonly');
    const stored = await requestResult(store.get(DEFAULT_WORKSPACE_ID)) as unknown;
    if (stored === undefined) {
      const workspace = createDefaultWorkspace();
      await this.commit(workspace);
      return { status: 'ready', workspace };
    }
    try {
      // Upgrade before validating: a v1 payload does not contain the to-do
      // widget, so the v2 validator would reject it and send an existing user
      // into the recovery screen. The migrated result is written back so the
      // upgrade only has to happen once.
      const normalised = normalizeWorkspace(stored, WORKSPACE_SCHEMA_VERSION);
      if (!normalised.ok) return { status: 'recovery-required', message: normalised.reason };
      const workspace = validateWorkspace(normalised.workspace);
      if (normalised.migrated) await this.commit(workspace);
      return normalised.migrated
        ? { status: 'ready', workspace, migrated: true }
        : { status: 'ready', workspace };
    } catch (error) {
      return {
        status: 'recovery-required',
        message: `本地数据需要恢复：${error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : '未知数据错误'} 可下载原始诊断数据、导入备份或明确清除后重建。`,
      };
    }
  }

  async exportRaw(): Promise<unknown> {
    const database = await this.open();
    const { store } = workspaceStore(database, 'readonly');
    return requestResult(store.get(DEFAULT_WORKSPACE_ID));
  }

  async commit(workspace: Workspace): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const validated = validateWorkspace(workspace);
      const database = await this.open();
      const { transaction, store } = workspaceStore(database, 'readwrite');
      try {
        store.put(validated);
        await transactionComplete(transaction);
      } catch (error) {
        try { transaction.abort(); } catch { /* Already completed or aborted. */ }
        throw storageError(error);
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async replace(workspace: Workspace, assets: readonly WorkspaceAsset[] = []): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const validated = validateWorkspace(workspace);
      const database = await this.open();
      const transaction = database.transaction(['workspaces', 'assets'], 'readwrite');
      try {
        transaction.objectStore('workspaces').put(validated);
        const assetStore = transaction.objectStore('assets');
        assetStore.clear();
        for (const asset of assets) assetStore.put(asset);
        await transactionComplete(transaction);
      } catch (error) {
        try { transaction.abort(); } catch { /* Already completed or aborted. */ }
        throw storageError(error);
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const { transaction, store } = workspaceStore(database, 'readwrite');
    store.clear();
    await transactionComplete(transaction);
  }

  close(): void {
    // A React unmount does not cancel IndexedDB requests. Let queued writes
    // finish before releasing the connection during a reload or tab close.
    void this.writeQueue.finally(() => {
      this.database?.close();
      this.database = undefined;
    });
  }
}
