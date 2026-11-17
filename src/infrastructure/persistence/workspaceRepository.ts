import { z } from 'zod';
import { openDatabase, requestResult, transactionComplete, workspaceStore } from './database';
import { createBlankWorkspace, createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { hasSeededShortcuts, markShortcutsSeeded } from './seedState';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION, type Workspace, type WorkspaceAsset, type WorkspaceBackupWidgetRecord } from '@/src/domain/workspace/model';
import { normalizeWorkspace } from '@/src/domain/workspace/migration';
import { validateWorkspace } from '@/src/domain/workspace/schema';

export type LoadWorkspaceResult =
  | { status: 'ready'; workspace: Workspace; migrated?: boolean }
  | { status: 'recovery-required'; message: string };

/** All three stores the app owns; "clear all data" must reach each one. */
const ALL_STORES = ['workspaces', 'assets', 'widget-data'] as const;

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
      /*
       * Only a genuine first install ships the 20 curated shortcuts. Once the
       * screen exists, "clear all data" or a wiped workspace must come back
       * empty — otherwise the presets the user deleted (or cleared) reappear,
       * and a personal "new tab" keeps resetting to a demo screen.
       */
      const firstRun = !hasSeededShortcuts();
      markShortcutsSeeded();
      const workspace = firstRun ? createDefaultWorkspace() : createBlankWorkspace();
      await this.commit(workspace);
      return { status: 'ready', workspace };
    }
    // An existing screen means the presets were already offered at some point,
    // including for users whose workspace predates this marker.
    markShortcutsSeeded();
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

  /**
   * Atomically replaces the workspace, its assets and, when supplied, its
   * widget data.
   *
   * `widgetData` is optional on purpose: `undefined` means "this caller has no
   * widget data to restore" (a backup exported before the field existed, or a
   * reset), so existing widget storage is left untouched. Passing an empty
   * array is different — it means "the backup genuinely has none", and stale
   * records from the current session must go.
   */
  async replace(
    workspace: Workspace,
    assets: readonly WorkspaceAsset[] = [],
    widgetData?: readonly WorkspaceBackupWidgetRecord[],
  ): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const validated = validateWorkspace(workspace);
      const database = await this.open();
      const stores = widgetData === undefined ? ['workspaces', 'assets'] as const : ALL_STORES;
      const transaction = database.transaction([...stores], 'readwrite');
      try {
        transaction.objectStore('workspaces').put(validated);
        const assetStore = transaction.objectStore('assets');
        assetStore.clear();
        for (const asset of assets) assetStore.put(asset);
        if (widgetData !== undefined) {
          const widgetStore = transaction.objectStore('widget-data');
          widgetStore.clear();
          for (const record of widgetData) {
            const payload = record.payload;
            widgetStore.put({
              key: `${record.namespace}:${record.key}`,
              namespace: record.namespace,
              payload,
              bytes: new TextEncoder().encode(payload).byteLength,
              updatedAt: record.updatedAt,
            });
          }
        }
        await transactionComplete(transaction);
      } catch (error) {
        try { transaction.abort(); } catch { /* Already completed or aborted. */ }
        throw storageError(error);
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  /**
   * Removes every row in all three stores.
   *
   * `clear()` used to touch only `workspaces`, so "clear all data" left images
   * and widget data behind — a privacy claim that was not true. The stores are
   * cleared in one transaction so a failure cannot leave a half-wiped database.
   */
  async clear(): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const database = await this.open();
      const transaction = database.transaction([...ALL_STORES], 'readwrite');
      try {
        for (const name of ALL_STORES) transaction.objectStore(name).clear();
        await transactionComplete(transaction);
      } catch (error) {
        try { transaction.abort(); } catch { /* Already completed or aborted. */ }
        throw storageError(error);
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
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
