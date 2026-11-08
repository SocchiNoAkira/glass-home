const DATABASE_NAME = 'glass-home';
const DATABASE_VERSION = 3;
const WORKSPACE_STORE = 'workspaces';
const ASSET_STORE = 'assets';
const WIDGET_DATA_STORE = 'widget-data';

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('本地存储请求失败')), { once: true });
  });
}

export function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('本地存储事务已中止')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('本地存储事务失败')), { once: true });
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const database = request.result;
      // Version 2 introduced assets; version 3 adds per-instance widget data.
      // Both steps are additive, so an existing Workspace or asset store is
      // never recreated and no user data can be lost by the upgrade.
      const previous = event.oldVersion;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) database.createObjectStore(WORKSPACE_STORE, { keyPath: 'workspaceId' });
      if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(WIDGET_DATA_STORE) && previous < 3) {
        database.createObjectStore(WIDGET_DATA_STORE, { keyPath: 'key' });
      }
    });
    request.addEventListener('success', () => {
      const database = request.result;
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('无法打开本地存储')), { once: true });
    request.addEventListener('blocked', () => reject(new Error('本地存储升级被其他标签页阻塞，请关闭旧版 Glass Home 后重试。')), { once: true });
  });
}

export function workspaceStore(database: IDBDatabase, mode: IDBTransactionMode): { transaction: IDBTransaction; store: IDBObjectStore } {
  const transaction = database.transaction(WORKSPACE_STORE, mode);
  return { transaction, store: transaction.objectStore(WORKSPACE_STORE) };
}

export function assetStore(database: IDBDatabase, mode: IDBTransactionMode): { transaction: IDBTransaction; store: IDBObjectStore } {
  const transaction = database.transaction(ASSET_STORE, mode);
  return { transaction, store: transaction.objectStore(ASSET_STORE) };
}

export function widgetDataStore(database: IDBDatabase, mode: IDBTransactionMode): { transaction: IDBTransaction; store: IDBObjectStore } {
  const transaction = database.transaction(WIDGET_DATA_STORE, mode);
  return { transaction, store: transaction.objectStore(WIDGET_DATA_STORE) };
}
