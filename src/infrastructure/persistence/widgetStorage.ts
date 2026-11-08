import { openDatabase, requestResult, transactionComplete, widgetDataStore } from './database';

/**
 * Per-instance widget storage (baseline 10.x "待办、便签等 Widget 数据 | 按实例
 * 隔离的本地存储").
 *
 * Deliberately separate from Workspace, for two reasons:
 * - a to-do checkbox must not bump the Workspace revision, which would push a
 *   layout transaction onto the undo stack for a checkbox;
 * - one widget's data must never be readable by another, so the key is
 *   `${namespace}:${key}` and the namespace belongs to the instance.
 */

export const WIDGET_STORAGE_QUOTA_BYTES = 256 * 1024;

export class WidgetQuotaExceededError extends Error {
  constructor(readonly namespace: string, readonly attemptedBytes: number) {
    super(`组件存储超出配额（${WIDGET_STORAGE_QUOTA_BYTES} 字节），本次写入未保存。`);
    this.name = 'WidgetQuotaExceededError';
  }
}

interface WidgetRecord {
  readonly key: string;
  readonly namespace: string;
  readonly payload: string;
  readonly bytes: number;
  readonly updatedAt: string;
}

function recordKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/** Byte length of the JSON payload, which is what the quota is measured in. */
export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export type QuotaVerdict =
  | { readonly fits: true; readonly nextUsage: number }
  | { readonly fits: false; readonly nextUsage: number };

/**
 * Quota arithmetic, kept pure so it is testable without IndexedDB.
 *
 * Replacing a key frees its old bytes, so the decision is made on the net
 * change: rewriting the same payload must not fail once the namespace is near
 * its limit. This is exactly the bug a naive `current + bytes` check has.
 */
export function evaluateQuota(currentUsage: number, bytes: number, previousBytes: number | undefined): QuotaVerdict {
  const net = bytes - (previousBytes ?? 0);
  const nextUsage = currentUsage + net;
  return nextUsage > WIDGET_STORAGE_QUOTA_BYTES ? { fits: false, nextUsage } : { fits: true, nextUsage };
}

export class WidgetStorage {
  private database: IDBDatabase | undefined;

  async open(): Promise<void> {
    if (!this.database) this.database = await openDatabase();
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private require(): IDBDatabase {
    if (!this.database) throw new Error('组件存储尚未打开。');
    return this.database;
  }

  /** Total bytes currently stored for one namespace. */
  async usage(namespace: string): Promise<number> {
    const { store } = widgetDataStore(this.require(), 'readonly');
    const request = store.getAll();
    const records = await requestResult(request) as WidgetRecord[];
    return records.filter((record) => record.namespace === namespace).reduce((sum, record) => sum + record.bytes, 0);
  }

  async read<T>(namespace: string, key: string): Promise<T | undefined> {
    const { store } = widgetDataStore(this.require(), 'readonly');
    const request = store.get(recordKey(namespace, key));
    const record = await requestResult(request) as WidgetRecord | undefined;
    if (!record || record.namespace !== namespace) return undefined;
    try {
      return JSON.parse(record.payload) as T;
    } catch {
      // A corrupt payload must read as absent rather than throw into the widget.
      return undefined;
    }
  }

  async write(namespace: string, key: string, value: unknown): Promise<void> {
    const bytes = payloadBytes(value);
    const current = await this.usage(namespace);
    const previous = await this.read<unknown>(namespace, key);
    const verdict = evaluateQuota(current, bytes, previous === undefined ? undefined : payloadBytes(previous));
    if (!verdict.fits) throw new WidgetQuotaExceededError(namespace, verdict.nextUsage);

    const record: WidgetRecord = {
      key: recordKey(namespace, key),
      namespace,
      payload: JSON.stringify(value),
      bytes,
      updatedAt: new Date().toISOString(),
    };
    const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
    store.put(record);
    await transactionComplete(transaction);
  }

  async remove(namespace: string, key: string): Promise<void> {
    const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
    store.delete(recordKey(namespace, key));
    await transactionComplete(transaction);
  }

  /** Drops all data for one instance, e.g. when its widget is removed. */
  async clearNamespace(namespace: string): Promise<void> {
    const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
    const request = store.getAll();
    const records = await requestResult(request) as WidgetRecord[];
    for (const record of records) {
      if (record.namespace === namespace) store.delete(record.key);
    }
    await transactionComplete(transaction);
  }
}
