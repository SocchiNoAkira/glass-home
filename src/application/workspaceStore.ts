import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceRepository, type LoadWorkspaceResult } from '@/src/infrastructure/persistence/workspaceRepository';
import { AssetRepository } from '@/src/infrastructure/persistence/assetRepository';
import type { Workspace, WorkspaceAsset } from '@/src/domain/workspace/model';
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
  if (!repositoryRef.current) repositoryRef.current = new WorkspaceRepository();
  if (!assetsRef.current) assetsRef.current = new AssetRepository();
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
    };
  }, [updateWorkspace]);

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

  const commitImport = useCallback(async (candidate: Workspace, assets: readonly WorkspaceAsset[] = []): Promise<void> => {
    await enqueueCommitRef.current(async () => {
      const operation = ++operationRef.current;
      previewCoordinatorRef.current.cancel();
      updatePreview(undefined);
      setSaveState('saving');
      try {
        await repositoryRef.current?.replace(candidate, assets);
        if (!mountedRef.current || operation !== operationRef.current) return;
        updateWorkspace(candidate);
        historyRef.current.clear();
        setHistoryVersion((version) => version + 1);
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
    await commitImport(candidate);
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
    loadError, saveState, saveError, notice, columns, wallpaperUrl,
    commit, commitImport, reset, changeWallpaper, reportError, clearError,
    displayWorkspace, preview, previewLayout, cancelLayoutPreview, commitLayoutPreview,
    undoLayout, redoLayout, clearHistory,
    canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo,
    historyVersion,
  };
}

export type WorkspaceStore = ReturnType<typeof useWorkspace>;
