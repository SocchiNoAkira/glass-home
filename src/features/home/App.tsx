import { useEffect, useState } from 'react';
import { Check, LayoutGrid, Plus, Redo2, Settings2, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { useWorkspace } from '@/src/application/workspaceStore';
import { useAdaptiveInk } from '@/src/features/theme/adaptiveInk';
import { HomeGrid } from '@/src/features/grid/HomeGrid';
import { ShortcutEditor, type ShortcutDraft } from '@/src/features/shortcuts/ShortcutEditor';
import { SettingsPanel, type SettingsTab } from '@/src/features/settings/SettingsPanel';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { RecoveryActions } from '@/src/features/settings/RecoveryActions';
import { addShortcut, addWidget, removeShortcut, removeWidget, updateSettings, updateShortcut } from '@/src/domain/workspace/commands';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { decodeBackupAssets, backupWidgetRecords, downloadBackup, exportBackup, readBackupFile } from '@/src/infrastructure/persistence/backup';
import { validateWorkspace } from '@/src/domain/workspace/schema';
import type { Shortcut, WidgetInstance, Workspace, WorkspaceAsset, WorkspaceSettings } from '@/src/domain/workspace/model';
import { widgetCatalogEntry, type BuiltinWidgetId } from '@/src/domain/widget/catalog';
import { WidgetGallery } from '@/src/features/widget/WidgetGallery';

export function App() {
  const store = useWorkspace();
  const { workspace } = store;
  const [editMode, setEditMode] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [removingShortcut, setRemovingShortcut] = useState<Shortcut>();
  const [widgetGallery, setWidgetGallery] = useState(false);
  const [removingWidget, setRemovingWidget] = useState<WidgetInstance>();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Per-namespace byte usage shown in the data tab, refreshed when the panel
  // opens and after any clear, so the number the user is deciding on is real.
  const [widgetSizes, setWidgetSizes] = useState<Readonly<Record<string, number>>>({});
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An uncommitted drag consumes Esc first (product baseline 7.2); the grid
      // handles that in the capture phase, so this only sees previews.
      if (event.key === 'Escape' && store.preview) {
        event.preventDefault();
        store.cancelLayoutPreview();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store.preview, store.cancelLayoutPreview]);

  // Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z redo (product baseline 7.3). Text
  // fields keep their own undo stack, so they are skipped.
  useEffect(() => {
    const isTextEntry = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]') != null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (isTextEntry(event.target)) return;
      // A preview owns the layout right now; undo/redo buttons are disabled too.
      if (store.preview) return;
      event.preventDefault();
      if (event.shiftKey) {
        if (store.canRedo) void store.redoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '重做失败。'));
        return;
      }
      if (store.canUndo) void store.undoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '撤销失败。'));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store.preview, store.canUndo, store.canRedo, store.undoLayout, store.redoLayout, store.reportError]);

  const importWorkspace = async (file: File) => {
    setBusy(true);
    try {
      const backup = await readBackupFile(file);
      const candidate = { ...backup.workspace, revision: (workspace?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
      validateWorkspace(candidate);
      const assets = await decodeBackupAssets(backup);
      // Widget data travels with the backup (baseline 14.3). A file exported
      // before the field existed yields `undefined`, which keeps the existing
      // widget rows instead of wiping them.
      await store.commitImport(candidate, assets, backupWidgetRecords(backup));
      if (backup.workspace.settings.wallpaperAssetId) {
        const asset = await store.assets.get(backup.workspace.settings.wallpaperAssetId);
        store.changeWallpaper(asset ? URL.createObjectURL(asset.blob) : undefined);
      } else store.changeWallpaper(undefined);
    } finally {
      setBusy(false);
    }
  };

  const exportRawWorkspace = async () => {
    if (!store.repository) throw new Error('本地存储尚未就绪，请重试。');
    const raw = await store.repository.exportRaw();
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `glass-home-raw-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Reads per-widget byte usage so the data panel can show real numbers. */
  const refreshWidgetSizes = async () => {
    const storage = store.widgetStorage;
    if (!storage || !workspace) { setWidgetSizes({}); return; }
    try {
      const records = await storage.snapshot(workspace.widgets.map((widget) => widget.storageNamespace));
      const sizes: Record<string, number> = {};
      for (const record of records) {
        // `snapshot` carries the stored payload text, not a byte count, so the
        // same measurement as the quota check is applied here.
        sizes[record.namespace] = (sizes[record.namespace] ?? 0)
          + new TextEncoder().encode(record.payload).byteLength;
      }
      setWidgetSizes(sizes);
    } catch {
      // A usage readout is not worth an error toast; show zeros instead.
      setWidgetSizes({});
    }
  };

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    if (tab === 'data') void refreshWidgetSizes();
  };

  const clearWidgetData = async (namespace: string) => {
    await store.clearWidgetData(namespace);
    await refreshWidgetSizes();
  };

  const clearAllData = async () => {
    await store.clearAllData();
    // The in-memory workspace now describes data that no longer exists; a
    // reload is the only honest state, and it re-runs first-run creation.
    window.location.reload();
  };

  const themeDark = workspace
    ? workspace.settings.theme === 'system' ? systemDark : workspace.settings.theme === 'dark'
    : systemDark;

  useAdaptiveInk({
    wallpaperUrl: store.wallpaperUrl,
    wallpaperGradient: workspace?.settings.wallpaperGradient ?? 'dawn',
    theme: themeDark ? 'dark' : 'light',
    overlay: workspace?.settings.wallpaperOverlay ?? 0,
    revision: workspace?.revision ?? 0,
  });

  if (!workspace) {
    return <div className="app app--loading theme-dark">
      <div className="wallpaper wallpaper--dawn" aria-hidden="true" />
      <main className="loading-screen" data-adaptive-ink="">
        <span className="brand__mark"><span /><span /><span /></span>
        {store.loadError ? <div className="recovery-card glass-panel" role="alert" data-adaptive-ink="">
          <h1>主屏幕需要恢复</h1><p>{store.loadError}</p>
          <RecoveryActions onExport={exportRawWorkspace} onImport={importWorkspace} onReset={() => setResetConfirm(true)} />
        </div> : <p role="status">正在打开你的空间…</p>}
      </main>
      {resetConfirm && <ConfirmDialog title="重建默认主屏幕" description="这将清除 Glass Home 的本地工作区。若需要保留现有数据，请先不要继续。" confirmLabel="清除并重建" dangerous onClose={() => setResetConfirm(false)} onConfirm={() => {
        setResetConfirm(false);
        void store.reset(createDefaultWorkspace()).then(() => window.location.reload()).catch((error: unknown) => store.reportError(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请重试。'));
      }} />}
    </div>;
  }

  const wallpaperBlur = workspace.settings.wallpaperBlur;
  const wallpaperStyle: React.CSSProperties | undefined = store.wallpaperUrl
    ? {
      backgroundImage: `url(${JSON.stringify(store.wallpaperUrl).slice(1, -1)})`,
      // Blur belongs to the image, not to a backdrop-filter on the veil: a
      // backdrop filter also had to fight the veil's own opacity, and with no
      // custom image there was nothing to blur at all.
      filter: wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : undefined,
    }
    : undefined;

  /**
   * Runs a domain command that may throw *synchronously*, then commits it.
   *
   * `addShortcut` throws while building the candidate (grid full, no legal
   * placement). That throw happens during argument evaluation of
   * `store.commit(addShortcut(...))` — before `commit` is ever called — so the
   * trailing `.catch(() => undefined)` never sees it. The result was an
   * uncaught error in the event handler and a click that did nothing at all,
   * with no toast and no explanation.
   *
   * Wrapping the *call* (not just the promise) is what makes the failure
   * visible: the user gets the command's own reason instead of silence.
   */
  const runCommand = (build: () => Workspace, successMessage: string) => {
    let next: Workspace;
    try {
      next = build();
    } catch (error) {
      store.reportError(error instanceof Error ? error.message : '操作未完成，请重试。');
      return;
    }
    void store.commit(next, successMessage).catch(() => undefined);
  };

  const saveShortcut = (draft: ShortcutDraft, shortcut?: Shortcut) => {
    const now = new Date().toISOString();
    if (shortcut) {
      runCommand(() => updateShortcut(workspace, { ...shortcut, ...draft, updatedAt: now }), '快捷方式已更新。');
      setEditingShortcut(undefined);
      return;
    }
    const id = crypto.randomUUID();
    runCommand(() => addShortcut(workspace, { ...draft, id, createdAt: now, updatedAt: now }), '已添加到所有断点的空位。');
    setEditingShortcut(undefined);
  };

  const duplicateShortcut = (shortcut: Shortcut) => {
    const now = new Date().toISOString();
    runCommand(
      () => addShortcut(workspace, { ...shortcut, id: crypto.randomUUID(), title: `${shortcut.title} 副本`.slice(0, 40), createdAt: now, updatedAt: now }),
      '已复制快捷方式。',
    );
  };

  const addWidgetToScreen = (widgetId: BuiltinWidgetId) => {
    runCommand(() => addWidget(workspace, widgetId), `已添加${widgetCatalogEntry(widgetId)?.label ?? '小组件'}。`);
    setWidgetGallery(false);
  };

  /**
   * Removes one widget and the data it owns.
   *
   * The data clear happens only after the workspace change is on disk: a failed
   * save must not leave a widget on screen whose contents were already wiped.
   * Clearing is also what keeps the data model honest — the settings panel and
   * backups address widget data by the namespaces of *present* instances, so an
   * orphan row would be invisible and unexportable.
   */
  const removeWidgetFromScreen = async (widget: WidgetInstance) => {
    setRemovingWidget(undefined);
    let next: Workspace;
    try {
      next = removeWidget(workspace, widget.instanceId);
    } catch (error) {
      store.reportError(error instanceof Error ? error.message : '移除小组件失败，请重试。');
      return;
    }
    try {
      await store.commit(next, '小组件已移除，它的数据也已清除。');
    } catch {
      return; // `commit` already surfaced the failure and rolled the workspace back.
    }
    try {
      await store.clearWidgetData(widget.storageNamespace);
    } catch (error) {
      store.reportError(error instanceof Error ? `小组件已移除，但数据未能清除：${error.message}` : '小组件已移除，但数据未能清除。');
    }
  };

  const saveSettings = async (settings: WorkspaceSettings, asset?: WorkspaceAsset) => {
    setBusy(true);
    try {
      if (asset) await store.assets.put(asset);
      const next = updateSettings(workspace, settings);
      if (settings.theme === 'system') setSystemDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
      await store.commit(next, '设置已保存。');
      if (asset) store.changeWallpaper(URL.createObjectURL(asset.blob));
      else if (!settings.wallpaperAssetId) store.changeWallpaper(undefined);
    } finally {
      setBusy(false);
    }
  };

  return <div
    className={`app material-${workspace.settings.materialQuality} wallpaper-${workspace.settings.wallpaperGradient} ${themeDark ? 'theme-dark' : 'theme-light'} ${editMode ? 'is-editing' : ''} ${workspace.settings.reducedMotion ? 'reduced-motion' : ''}`}
    data-testid="glass-home-app" data-columns={store.columns} data-material={workspace.settings.materialQuality} data-theme={themeDark ? 'dark' : 'light'}
  >
    {/*
      The decorations (colour orbs, horizon band, top/bottom and radial washes)
      exist to turn a flat gradient into something that looks designed. A custom
      image is already a picture, so they only paint a dirty pane of glass over
      it: `wallpaper--custom` switches every one of them off in CSS, and the
      light theme's brightness/saturation push is dropped with them.
    */}
    <div className={`wallpaper wallpaper--${workspace.settings.wallpaperGradient} ${store.wallpaperUrl ? 'wallpaper--custom' : ''}`} aria-hidden="true">
      <div className={`wallpaper__custom ${wallpaperBlur > 0 ? 'wallpaper__custom--blurred' : ''}`} style={wallpaperStyle} />
      <div className="wallpaper__orb wallpaper__orb--peach" /><div className="wallpaper__orb wallpaper__orb--blue" /><div className="wallpaper__orb wallpaper__orb--lilac" />
      <div className="wallpaper__horizon" />
    </div>
    {/*
      "明暗遮罩": dims the background in dark theme, lightens it in light theme,
      so text stays readable over whatever is behind it. It applies to a custom
      image too — once the decorations are gone, this is the only thing tuning
      the picture's contrast, and at 0% the image is shown untouched.
    */}
    <div
      className="wallpaper-overlay"
      style={{ opacity: workspace.settings.wallpaperOverlay / 100 }}
      aria-hidden="true"
    />
    <div className="page-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Glass Home 首页" data-adaptive-ink="" onClick={(event) => { event.preventDefault(); setEditMode(false); setSettingsTab(undefined); }}>
          <span className="brand__mark"><span /><span /><span /></span><span>Glass Home<span className="brand__badge">BETA</span></span>
        </a>
        <div className="topbar__right" data-adaptive-ink="">
          <span className={`local-status local-status--${store.saveState}`} role="status" data-save-state={store.saveState}><span className="status-dot" />{store.saveState === 'saving' ? '正在保存到本地…' : store.saveState === 'error' ? '本地保存需要处理' : '一切就绪，只在本地'}</span>
          <button className="icon-button" aria-label="撤销布局" title="撤销布局" disabled={!store.canUndo || Boolean(store.preview)} onClick={() => void store.undoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '撤销失败。'))}><Undo2 size={17} /></button>
          <button className="icon-button" aria-label="重做布局" title="重做布局" disabled={!store.canRedo || Boolean(store.preview)} onClick={() => void store.redoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '重做失败。'))}><Redo2 size={17} /></button>
          <button className="icon-button" aria-label="打开设置" title="设置" onClick={() => openSettings('appearance')}><Settings2 size={18} /></button>
          <span className="topbar__divider" /><span className="topbar__monogram" aria-hidden="true">G</span>
        </div>
      </header>
      <main id="main-content" className="main-layout">
        {/*
          The preview notice is absolutely positioned and does NOT sit in the
          flow. As a normal block it added a line above the grid, which shifted
          every object down by one row the moment a drag preview appeared: the
          grid underneath the pointer moved, so aiming was impossible and the
          content visibly jittered as previews came and went.
        */}
        {store.preview && <div className="layout-preview-banner" role="status">正在预览未保存的布局；按 Esc 取消。</div>}
        <div className="home-content">
          <HomeGrid workspace={store.displayWorkspace ?? workspace} columns={store.columns} editMode={editMode}
            environment={{
              theme: themeDark ? 'dark' : 'light',
              language: document.documentElement.lang || 'zh-CN',
              reducedMotion: workspace.settings.reducedMotion,
              materialQuality: workspace.settings.materialQuality,
            }}
            widgetStorage={store.widgetStorage}
            widgetDataVersion={store.widgetDataVersion}
            onEditShortcut={setEditingShortcut}
            onDuplicateShortcut={duplicateShortcut}
            onRemoveShortcut={setRemovingShortcut}
            onPreviewLayout={store.previewLayout}
            onCommitLayout={store.commitLayoutPreview}
            onCancelLayout={store.cancelLayoutPreview}
            onWidgetError={(_instanceId, message) => store.reportError(message)}
            onRemoveWidget={(instanceId) => setRemovingWidget(workspace.widgets.find((widget) => widget.instanceId === instanceId))}
          />
          {workspace.shortcuts.length === 0 && <div className="empty-state glass-surface" data-adaptive-ink=""><h2>从这里，开始你的空间</h2><p>还没有快捷方式。添加常用网站，让主屏幕更像你。</p><button className="button button--primary" onClick={() => setEditingShortcut(null)}><Plus size={16} />添加快捷方式</button></div>}
        </div>
      </main>
      <footer className="bottom-bar">
        <div className="bottom-bar__left" data-adaptive-ink=""><Sparkles size={14} /><span>{editMode ? '拖动图标或组件即可调整布局；选中后方向键微调，Alt+方向键改尺寸。' : '少一点干扰，多一点专注。拖动图标可调整布局。'}</span></div>
        <div className="bottom-bar__right">
          {editMode && <button
            className="icon-button add-button"
            aria-label="整理布局"
            title="紧凑整理：向上向左压缩空白，立即保存"
            onClick={() => void store.compactLayout(store.columns).catch(() => undefined)}
          ><Wand2 size={18} /></button>}
          <button className="edit-button glass-control" onClick={() => setWidgetGallery(true)} aria-label="添加小组件"><Plus size={15} />小组件</button>
          {!editMode
            ? <button className="edit-button glass-control" onClick={() => setEditMode(true)}><LayoutGrid size={15} />编辑主屏幕</button>
            : <button className="done-button" onClick={() => setEditMode(false)}><Check size={16} />完成</button>}
          <button className="icon-button add-button" aria-label="添加快捷方式" title="添加快捷方式" onClick={() => setEditingShortcut(null)}><Plus size={20} /></button>
        </div>
      </footer>
    </div>
    {editMode && <div className="sr-only" role="status">已进入编辑模式。可以编辑快捷方式，或在布局内核验收面板选择目标格、预览并保存布局。</div>}
    {(store.saveError || store.notice) && <div className={`toast ${store.saveError ? 'toast--error' : ''}`} role={store.saveError ? 'alert' : 'status'}><span>{store.saveError ?? store.notice}</span>{store.saveError && <button onClick={store.clearError} aria-label="关闭错误提示">×</button>}</div>}
    {editingShortcut !== undefined && <ShortcutEditor shortcut={editingShortcut ?? undefined} defaultTarget={workspace.settings.openTarget} onSave={saveShortcut} onClose={() => setEditingShortcut(undefined)} />}
    {settingsTab && <SettingsPanel settings={workspace.settings} initialTab={settingsTab} wallpaperUrl={store.wallpaperUrl} busy={busy}
      widgetData={workspace.widgets.map((widget) => ({ instanceId: widget.instanceId, namespace: widget.storageNamespace, bytes: widgetSizes[widget.storageNamespace] ?? 0 }))}
      onSave={saveSettings} onClose={() => setSettingsTab(undefined)}
      onExport={async () => {
        // Widget storage must be open, otherwise the backup would silently
        // claim "no widget data" and lose the user's list on restore.
        if (!store.widgetStorage) throw new Error('组件存储尚未就绪，请稍后重试导出。');
        downloadBackup(await exportBackup(workspace, store.assets, store.widgetStorage));
      }}
      onImport={importWorkspace} onReset={() => setResetConfirm(true)}
      onRequestWidgetData={() => void refreshWidgetSizes()}
      onClearWidgetData={clearWidgetData} onClearAllData={clearAllData} />}
    {removingShortcut && <ConfirmDialog title={`删除「${removingShortcut.title}」？`} description="将从所有断点移除此快捷方式。不会删除任何浏览记录或网站数据。" confirmLabel="删除快捷方式" dangerous onClose={() => setRemovingShortcut(undefined)} onConfirm={() => { runCommand(() => removeShortcut(workspace, removingShortcut.id), '快捷方式已删除。'); setRemovingShortcut(undefined); }} />}
    {widgetGallery && <WidgetGallery
      present={workspace.widgets.map((widget) => widget.widgetId)}
      busy={busy}
      onAdd={addWidgetToScreen}
      onClose={() => setWidgetGallery(false)}
    />}
    {removingWidget && <ConfirmDialog
      title={`移除「${widgetCatalogEntry(removingWidget.widgetId)?.label ?? '小组件'}」？`}
      description="会从所有断点移除这个小组件，并清除它保存的数据（例如待办内容）。之后可以从「小组件」里重新添加。"
      confirmLabel="移除小组件"
      dangerous
      onClose={() => setRemovingWidget(undefined)}
      onConfirm={() => void removeWidgetFromScreen(removingWidget)}
    />}
    {resetConfirm && <ConfirmDialog title="恢复默认主屏幕？" description="此操作会替换你的设置、布局、快捷方式和本地壁纸。建议先导出备份。" confirmLabel="恢复默认" dangerous onClose={() => setResetConfirm(false)} onConfirm={() => { setResetConfirm(false); void store.reset(createDefaultWorkspace()).catch((error: unknown) => store.reportError(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请重试。')); }} />}
  </div>;
}
