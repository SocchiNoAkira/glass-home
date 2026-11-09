import { openDatabase, requestResult, transactionComplete, widgetDataStore } from './database';
import { WIDGET_NAMESPACE_QUOTA_BYTES } from '@/src/domain/workspace/model';

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

// Single source of truth lives in the domain, so the backup validator can
// enforce the same limit without persistence importing itself.
export const WIDGET_STORAGE_QUOTA_BYTES = WIDGET_NAMESPACE_QUOTA_BYTES;

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

/**
 * Inverse of `recordKey`, for callers that receive a composite key back.
 *
 * Splitting on the first ':' would be wrong for a namespaced widgetId such as
 * `com.example.notes`, so the caller's known namespace is stripped verbatim.
 */
export function localKey(namespace: string, storedKey: string): string {
  const prefix = `${namespace}:`;
  return storedKey.startsWith(prefix) ? storedKey.slice(prefix.length) : storedKey;
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
  /**
   * Serialises every operation in call order.
   *
   * Widgets persist fire-and-forget (a checkbox must not block the UI), so a
   * write can still be in flight when the user exports a backup or clears data.
   * Without this queue, an export could read before a pending write lands (losing
   * the newest to-do), and a late write could resurrect data the user just
   * deliberately cleared.
   */
  private queue: Promise<unknown> = Promise.resolve();

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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Queued entry points delegate to these unqueued cores. Calling the public
   * methods from inside a queued operation would wait on itself and deadlock.
   */
  private async usageNow(namespace: string): Promise<number> {
    const { store } = widgetDataStore(this.require(), 'readonly');
    const request = store.getAll();
    const records = await requestResult(request) as WidgetRecord[];
    return records.filter((record) => record.namespace === namespace).reduce((sum, record) => sum + record.bytes, 0);
  }

  private async readNow<T>(namespace: string, key: string): Promise<T | undefined> {
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

  /** Total bytes currently stored for one namespace. */
  async usage(namespace: string): Promise<number> {
    return this.enqueue(() => this.usageNow(namespace));
  }

  async read<T>(namespace: string, key: string): Promise<T | undefined> {
    return this.enqueue(() => this.readNow<T>(namespace, key));
  }

  async write(namespace: string, key: string, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      const bytes = payloadBytes(value);
      const current = await this.usageNow(namespace);
      const previous = await this.readNow<unknown>(namespace, key);
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
    });
  }

  async remove(namespace: string, key: string): Promise<void> {
    return this.enqueue(async () => {
      const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
      store.delete(recordKey(namespace, key));
      await transactionComplete(transaction);
    });
  }

  /** Drops all data for one instance, e.g. when its widget is removed. */
  async clearNamespace(namespace: string): Promise<void> {
    return this.enqueue(async () => {
      const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
      const request = store.getAll();
      const records = await requestResult(request) as WidgetRecord[];
      for (const record of records) {
        if (record.namespace === namespace) store.delete(record.key);
      }
      await transactionComplete(transaction);
    });
  }

  /**
   * Copies every stored record belonging to one of `namespaces`.
   *
   * Scoped to the caller's namespaces instead of dumping the whole store so a
   * backup cannot pick up leftovers from an instance the current workspace no
   * longer declares — importing those would resurrect data the user removed.
   * Keys are returned in their *local* form so a backup file reads as
   * `{ namespace: 'builtin.todo', key: 'state' }` rather than exposing the
   * composite storage key.
   */
  async snapshot(namespaces: readonly string[]): Promise<WidgetRecordSnapshot[]> {
    // Queued so a pending widget write is included: exporting the moment a
    // checkbox is ticked must not produce a backup missing that change.
    return this.enqueue(async () => {
      const allowed = new Set(namespaces);
      const { store } = widgetDataStore(this.require(), 'readonly');
      const records = await requestResult(store.getAll()) as WidgetRecord[];
      return records
        .filter((record) => allowed.has(record.namespace))
        .map((record) => ({
          namespace: record.namespace,
          key: localKey(record.namespace, record.key),
          payload: record.payload,
          updatedAt: record.updatedAt,
        }))
        .sort((left, right) => left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key));
    });
  }

  /**
   * Writes a batch of records in one transaction.
   *
   * Used by import and replace: an import that half-applied would leave a
   * widget showing another user's data, so all records land together or none.
   */
  async putRecords(records: readonly WidgetRecordSnapshot[]): Promise<void> {
    if (records.length === 0) return;
    return this.enqueue(async () => {
      const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
      for (const record of records) {
        store.put({
          key: recordKey(record.namespace, record.key),
          namespace: record.namespace,
          payload: record.payload,
          bytes: new TextEncoder().encode(record.payload).byteLength,
          updatedAt: record.updatedAt,
        } satisfies WidgetRecord);
      }
      await transactionComplete(transaction);
    });
  }

  /** Bytes currently held by every record, used by the data-management panel. */
  async totalUsage(): Promise<number> {
    return this.enqueue(async () => {
      const { store } = widgetDataStore(this.require(), 'readonly');
      const records = await requestResult(store.getAll()) as WidgetRecord[];
      return records.reduce((sum, record) => sum + record.bytes, 0);
    });
  }

  /** Drops every stored record, for the explicit "clear all data" action. */
  async clearAll(): Promise<void> {
    // Queued for the same reason as `clearNamespace`: a write that is already in
    // flight must land *before* the clear, never after it.
    return this.enqueue(async () => {
      const { transaction, store } = widgetDataStore(this.require(), 'readwrite');
      store.clear();
      await transactionComplete(transaction);
    });
  }
}

export type WidgetRecordSnapshot = Pick<WidgetRecord, 'namespace' | 'key' | 'payload' | 'updatedAt'>;
