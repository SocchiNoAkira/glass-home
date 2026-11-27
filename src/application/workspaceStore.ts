import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceRepository, type LoadWorkspaceResult } from '@/src/infrastructure/persistence/workspaceRepository';
import { AssetRepository } from '@/src/infrastructure/persistence/assetRepository';
import { WidgetStorage } from '@/src/infrastructure/persistence/widgetStorage';
import { clearReminderSchedule } from '@/src/infrastructure/reminders/scheduler';
import { REMINDER_WIDGET_ID, type Workspace, type WorkspaceAsset, type WorkspaceBackupWidgetRecord } from '@/src/domain/workspace/model';
import type { GridColumns } from '@/src/domain/grid/model';
import { DEFAULT_SOLVE_BUDGET, solveLayout, type LayoutCommand, type LayoutPreference } from '@/src/domain/grid/solver';
import { applyLayoutTransaction, createLayoutPreview, restoreLayoutTransaction, type LayoutTransaction } from '@/src/domain/layout/transaction';
import { LayoutHistory, LayoutPreviewCoordinator } from './layoutHistory';

export type SaveState = 'loading' | 'saved' | 'saving' | 'error';

export function getGridColumns(width: number): GridColumns {
  if (width >= 1080) return 10;
  if (width >= 720) return 8;
  return 5;
}

export function useWorkspace() {
  const repositoryRef = useRef<WorkspaceRepository | undefined>(undefined);
  const assetsRef = useRef<AssetRepository | undefined>(undefined);
  const widgetStorageRef = useRef<WidgetStorage | undefined>(undefined);
  if (!repositoryRef.current) repositoryRef.current = new WorkspaceRepository();
  if (!assetsRef.current) assetsRef.current = new AssetRepository();
  if (!widgetStorageRef.current) widgetStorageRef.current = new WidgetStorage();
  // Widget storage connects lazily; `storageReady` flips once the connection is
  // open so a widget never mounts against a half-initialised connection.
  const [storageReady, setStorageReady] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [loadError, setLoadError] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [saveError, setSaveError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [wallpaperUrl, setWallpaperUrl] = useState<string>();
  const [columns, setColumns] = useState<GridColumns>(() => getGridColumns(window.innerWidth));
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const workspaceRef = useRef<Workspace | undefined>(undefined);
  const historyRef = useRef(new LayoutHistory());
  const previewCoordinatorRef = useRef(new LayoutPreviewCoordinator());
  const [preview, setPreview] = useState<LayoutTransaction | undefined>(undefined);
  const previewRef = useRef<LayoutTransaction | undefined>(undefined);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Bumped whenever widget data is dropped outside a widget so every mounted
  // widget re-reads storage; without it a cleared list would keep rendering.
  const [widgetDataVersion, setWidgetDataVersion] = useState(0);
  const commitSequenceRef = useRef<Promise<unknown>>(Promise.resolve());

  const updateWorkspace = useCallback((next: Workspace | undefined) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);
  const updatePreview = useCallback((transaction: LayoutTransaction | undefined) => {
    previewRef.current = transaction;
    setPreview(transaction);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void repositoryRef.current?.load().then(async (result: LoadWorkspaceResult) => {
      if (!mountedRef.current) return;
      if (result.status === 'recovery-required') {
        setLoadError(result.message);
        setSaveState('error');
        return;
      }
      updateWorkspace(result.workspace);
      setSaveState('saved');
      // A v1 workspace upgraded on load is a real change the user should see.
      if (result.migrated) setNotice('本地数据已升级：新增内置待办组件。');
      const assetId = result.workspace.settings.wallpaperAssetId;
      if (assetId) {
        const asset = await assetsRef.current?.get(assetId);
        if (asset && mountedRef.current) setWallpaperUrl(URL.createObjectURL(asset.blob));
      }
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      setLoadError(error instanceof Error ? error.message : '无法读取本地工作区。');
      setSaveState('error');
    });
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      repositoryRef.current?.close();
      assetsRef.current?.close();
      widgetStorageRef.current?.close();
    };
  }, [updateWorkspace]);

  // Widget storage shares the IndexedDB connection pool but has its own store.
  // Opening it separately keeps a widget failure from blocking the workspace.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void widgetStorageRef.current?.open()
      .then(() => { if (!cancelled) setStorageReady(true); })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Widgets degrade to an error card; the main screen keeps working.
        setNotice(error instanceof Error ? `组件存储不可用：${error.message}` : '组件存储不可用。');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onResize = () => setColumns(getGridColumns(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => () => {
    if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
  }, [wallpaperUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const enqueueCommit = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = commitSequenceRef.current.then(operation, operation);
    commitSequenceRef.current = result.catch(() => undefined);
    return result;
  }, []);
  const enqueueCommitRef = useRef(enqueueCommit);
  enqueueCommitRef.current = enqueueCommit;

  /**
   * Deletes asset blobs the committed workspace no longer references.
   *
   * Every wallpaper change and icon edit left the previous blob in the `assets`
   * store forever: nothing ever deleted from it, so the database grew without
   * bound (up to 4MB per abandoned wallpaper). Orphans are invisible to backup
   * (export only collects referenced ids), so they were pure storage waste.
   *
   * Runs *after* the commit succeeds and scans the full reference set each time
   * rather than guessing which id became stale: two shortcuts may legitimately
   * share one asset (duplicating a shortcut copies the field), so
   * "the old id is unused" is only knowable by looking at the whole workspace.
   */
  const pruneAssets = useCallback(async (committed: Workspace): Promise<void> => {
    const assets = assetsRef.current;
    if (!assets) return;
    const referenced = new Set<string>();
    if (committed.settings.wallpaperAssetId) referenced.add(committed.settings.wallpaperAssetId);
    for (const shortcut of committed.shortcuts) {
      if (shortcut.iconAssetId) referenced.add(shortcut.iconAssetId);
    }
    try {
      const stored = await assets.listIds();
      for (const id of stored) {
        if (!referenced.has(id)) await assets.remove(id);
      }
    } catch {
      // Pruning is housekeeping: a failure must never fail the user's save.
    }
  }, []);

  const commitNow = useCallback(async (candidate: Workspace, successMessage?: string, resetHistory = false): Promise<void> => {
    const previous = workspaceRef.current;
    updateWorkspace(candidate);
    setSaveState('saving');
    setSaveError(undefined);
    const operation = ++operationRef.current;
    try {
      await repositoryRef.current?.commit(candidate);
      if (!mountedRef.current) return;
      if (resetHistory) {
        historyRef.current.clear();
        previewCoordinatorRef.current.cancel();
        updatePreview(undefined);
        setHistoryVersion((version) => version + 1);
      }
      setSaveState('saved');
      if (successMessage) setNotice(successMessage);
      // Housekeeping after a successful commit: drops blobs the new workspace
      // no longer references (old wallpapers, replaced icons).
      void pruneAssets(candidate);
    } catch (error) {
      if (!mountedRef.current || operation !== operationRef.current) return;
      updateWorkspace(previous);
      updatePreview(undefined);
      previewCoordinatorRef.current.cancel();
      setSaveState('error');
      const message = error instanceof Error ? `保存失败：${error.message} 已恢复操作前状态。` : '保存失败，已恢复操作前状态。';
      setSaveError(message);
      throw new Error(message, { cause: error });
    }
  }, [updatePreview, updateWorkspace]);

  const commit = useCallback(async (candidate: Workspace, successMessage?: string): Promise<void> => {
    await enqueueCommitRef.current(() => commitNow(candidate, successMessage, true));
  }, [commitNow]);

  const commitImport = useCallback(async (
    candidate: Workspace,
    assets: readonly WorkspaceAsset[] = [],
    /**
     * `undefined` = "the backup carries no widget-data field" (an older file):
     * leave stored widget rows alone. `[]` = "the backup genuinely has none":
     * clear them. The distinction matters, otherwise importing an old backup
     * would silently delete the user's to-do list.
     */
    widgetData?: readonly WorkspaceBackupWidgetRecord[],
  ): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const operation = ++operationRef.current;
      previewCoordinatorRef.current.cancel();
      updatePreview(undefined);
      setSaveState('saving');
      try {
        await repositoryRef.current?.replace(candidate, assets, widgetData);
        if (!mountedRef.current || operation !== operationRef.current) return;
        updateWorkspace(candidate);
        historyRef.current.clear();
        setHistoryVersion((version) => version + 1);
        // The imported records replaced every widget row, so mounted widgets
        // must reload before the next render reads their state.
        setWidgetDataVersion((version) => version + 1);
        setSaveState('saved');
        setNotice('备份已导入，主屏幕已恢复。');
      } catch (error) {
        if (!mountedRef.current || operation !== operationRef.current) return;
        setSaveState('error');
        throw error;
      }
    });
  }, [updatePreview, updateWorkspace]);

  const reset = useCallback(async (candidate: Workspace): Promise<void> => {
    // An explicit reset wants a genuinely empty widget store, so `[]` is passed
    // rather than `undefined` (which would mean "leave widget data alone").
    await commitImport(candidate, [], []);
    setWallpaperUrl(undefined);
  }, [commitImport]);

  const changeWallpaper = useCallback((url: string | undefined) => {
    setWallpaperUrl(url);
  }, []);

  const reportError = useCallback((message: string) => {
    setSaveState('error');
    setSaveError(message);
  }, []);

  const clearError = useCallback(() => setSaveError(undefined), []);


  /**
   * Drops one instance's stored rows (baseline 12.4 "清除单 Widget 数据").
   *
   * Only the widget store is touched: the instance keeps its cell, its layout
   * and its settings, because the user asked to clear the *data*, not to
   * remove the widget.
   */
  const clearWidgetData = useCallback(async (namespace: string): Promise<void> => {
    const storage = widgetStorageRef.current;
    if (!storage) throw new Error('组件存储尚未就绪，请稍后重试。');
    await enqueueCommitRef.current(() => storage.clearNamespace(namespace));
    if (namespace === REMINDER_WIDGET_ID) await clearReminderSchedule();
    if (mountedRef.current) setWidgetDataVersion((version) => version + 1);
  }, []);

  /**
   * Drops every row in every store Glass Home owns (baseline 12.4 "清除全部数据").
   *
   * Goes through `repository.clear()` only: it clears all three stores in one
   * transaction, so widget storage cannot be re-populated by a queued write
   * racing a separate clear on a different connection.
   */
  const clearAllData = useCallback(async (): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      await repositoryRef.current?.clear();
    });
    await clearReminderSchedule();
    if (mountedRef.current) setWidgetDataVersion((version) => version + 1);
  }, []);

  /** Bytes held by widget data, for the data-management panel. */
  const widgetStorageUsage = useCallback(async (): Promise<number> => {
    const storage = widgetStorageRef.current;
    if (!storage) return 0;
    return storage.totalUsage();
  }, []);

  const previewLayout = useCallback((breakpoint: GridColumns, command: LayoutCommand, preference: LayoutPreference = 'auto'): boolean => {
    const current = workspaceRef.current;
    if (!current) return false;
    const signature = `${breakpoint}:${preference}:${JSON.stringify(command)}`;
    const token = previewCoordinatorRef.current.begin(current.revision, signature);
    try {
      const result = solveLayout({ columns: breakpoint, items: current.layouts[breakpoint], command, preference, budget: DEFAULT_SOLVE_BUDGET, signal: token.signal });
      if (!previewCoordinatorRef.current.isCurrent(token) || workspaceRef.current?.revision !== token.baseRevision) return false;
      const candidate = createLayoutPreview(current, breakpoint, command, result, crypto.randomUUID());
      if (candidate.status === 'blocked') {
        updatePreview(undefined);
        setSaveError(candidate.reason);
        return false;
      }
      updatePreview(candidate.transaction);
      setSaveError(undefined);
      return true;
    } catch (error) {
      updatePreview(undefined);
      setSaveError(error instanceof Error ? error.message : '布局预览失败。');
      return false;
    } finally {
      previewCoordinatorRef.current.finish(token);
    }
  }, [updatePreview]);

  const cancelLayoutPreview = useCallback(() => {
    previewCoordinatorRef.current.cancel();
    updatePreview(undefined);
    setSaveError(undefined);
  }, [updatePreview]);

  const commitLayoutPreview = useCallback(async (): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const current = workspaceRef.current;
      const transaction = previewRef.current;
      if (!current || !transaction) throw new Error('没有可提交的布局预览。');
      const candidate = applyLayoutTransaction(current, transaction);
      await commitNow(candidate, '布局已保存，可撤销本次操作。');
      historyRef.current.record(transaction);
      setHistoryVersion((version) => version + 1);
      updatePreview(undefined);
    });
  }, [commitNow, updatePreview]);

  /**
   * One-click tidy: solve, apply and commit in one transaction.
   *
   * It used to open a preview and wait for a confirmation, which for a
   * deterministic, fully undoable operation only added a step between the click
   * and the result. Nothing is written when the layout cannot be improved, and a
   * real failure is still surfaced instead of being swallowed.
   */
  const compactLayout = useCallback(async (breakpoint: GridColumns): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const current = workspaceRef.current;
      if (!current) return;
      previewCoordinatorRef.current.cancel();
      updatePreview(undefined);
      setSaveError(undefined);
      try {
        const result = solveLayout({ columns: breakpoint, items: current.layouts[breakpoint], command: { type: 'compact' }, budget: DEFAULT_SOLVE_BUDGET });
        const candidate = createLayoutPreview(current, breakpoint, { type: 'compact' }, result, crypto.randomUUID());
        if (candidate.status === 'blocked') {
          // "Nothing to tidy" is an answer, not an error.
          setNotice(candidate.reason.includes('没有变化') ? '已经是紧凑排列，没有可压缩的空白。' : candidate.reason);
          return;
        }
        await commitNow(applyLayoutTransaction(current, candidate.transaction), '已整理并保存，可撤销。');
        historyRef.current.record(candidate.transaction);
        setHistoryVersion((version) => version + 1);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : '整理失败，请重试。');
      }
    });
  }, [commitNow, updatePreview]);

  const undoLayout = useCallback(async (): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const current = workspaceRef.current;
      const transaction = historyRef.current.peekUndo();
      if (!current || !transaction) return;
      previewCoordinatorRef.current.cancel();
      updatePreview(undefined);
      const candidate = restoreLayoutTransaction(current, transaction, 'undo');
      await commitNow(candidate, '已撤销上一次布局操作。');
      historyRef.current.completeUndo();
      setHistoryVersion((version) => version + 1);
    });
  }, [commitNow, updatePreview]);

  const redoLayout = useCallback(async (): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const current = workspaceRef.current;
      const transaction = historyRef.current.peekRedo();
      if (!current || !transaction) return;
      previewCoordinatorRef.current.cancel();
      updatePreview(undefined);
      const candidate = restoreLayoutTransaction(current, transaction, 'redo');
      await commitNow(candidate, '已重做布局操作。');
      historyRef.current.completeRedo();
      setHistoryVersion((version) => version + 1);
    });
  }, [commitNow, updatePreview]);

  const displayWorkspace = useMemo(() => {
    if (!workspace || !preview) return workspace;
    return { ...workspace, layouts: { ...workspace.layouts, [preview.breakpoint]: preview.after } };
  }, [workspace, preview]);

  const clearHistory = useCallback(() => {
    historyRef.current.clear();
    previewCoordinatorRef.current.cancel();
    updatePreview(undefined);
    setHistoryVersion((version) => version + 1);
  }, [updatePreview]);

  return {
    workspace, repository: repositoryRef.current, assets: assetsRef.current,
    widgetStorage: storageReady ? widgetStorageRef.current : undefined,
    widgetDataVersion,
    loadError, saveState, saveError, notice, columns, wallpaperUrl,
    commit, commitImport, reset, changeWallpaper, reportError, clearError,
    clearWidgetData, clearAllData, widgetStorageUsage,
    displayWorkspace, preview, previewLayout, cancelLayoutPreview, commitLayoutPreview, compactLayout,
    undoLayout, redoLayout, clearHistory,
    canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo,
    historyVersion,
  };
}

export type WorkspaceStore = ReturnType<typeof useWorkspace>;
