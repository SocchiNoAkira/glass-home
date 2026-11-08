import { useEffect, useState } from 'react';
import { Check, LayoutGrid, Plus, Redo2, Settings2, Sparkles, Undo2 } from 'lucide-react';
import { LayoutInspector } from '@/src/features/grid/LayoutInspector';
import { useWorkspace } from '@/src/application/workspaceStore';
import { HomeGrid } from '@/src/features/grid/HomeGrid';
import { ShortcutEditor, type ShortcutDraft } from '@/src/features/shortcuts/ShortcutEditor';
import { SettingsPanel, type SettingsTab } from '@/src/features/settings/SettingsPanel';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { RecoveryActions } from '@/src/features/settings/RecoveryActions';
import { addShortcut, removeShortcut, updateSettings, updateShortcut } from '@/src/domain/workspace/commands';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { decodeBackupAssets, downloadBackup, exportBackup, readBackupFile } from '@/src/infrastructure/persistence/backup';
import { validateWorkspace } from '@/src/domain/workspace/schema';
import type { Shortcut, WorkspaceAsset, WorkspaceSettings } from '@/src/domain/workspace/model';

export function App() {
  const store = useWorkspace();
  const { workspace } = store;
  const [editMode, setEditMode] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [removingShortcut, setRemovingShortcut] = useState<Shortcut>();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
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
      await store.commitImport(candidate, assets);
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

  if (!workspace) {
    return <div className="app app--loading theme-dark">
      <div className="wallpaper wallpaper--dawn" aria-hidden="true" />
      <main className="loading-screen">
        <span className="brand__mark"><span /><span /><span /></span>
        {store.loadError ? <div className="recovery-card glass-panel" role="alert">
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

  const themeDark = workspace.settings.theme === 'system' ? systemDark : workspace.settings.theme === 'dark';
  const wallpaperStyle = store.wallpaperUrl ? { backgroundImage: `url(${JSON.stringify(store.wallpaperUrl).slice(1, -1)})` } : undefined;

  const saveShortcut = (draft: ShortcutDraft, shortcut?: Shortcut) => {
    const now = new Date().toISOString();
    if (shortcut) {
      void store.commit(updateShortcut(workspace, { ...shortcut, ...draft, updatedAt: now }), '快捷方式已更新。').catch(() => undefined);
      setEditingShortcut(undefined);
      return;
    }
    const id = crypto.randomUUID();
    void store.commit(addShortcut(workspace, { ...draft, id, createdAt: now, updatedAt: now }), '已添加到所有断点的空位。').catch(() => undefined);
    setEditingShortcut(undefined);
  };

  const duplicateShortcut = (shortcut: Shortcut) => {
    const now = new Date().toISOString();
    void store.commit(addShortcut(workspace, { ...shortcut, id: crypto.randomUUID(), title: `${shortcut.title} 副本`.slice(0, 40), createdAt: now, updatedAt: now }), '已复制快捷方式。').catch(() => undefined);
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
    <div className={`wallpaper wallpaper--${workspace.settings.wallpaperGradient}`} aria-hidden="true">
      <div className="wallpaper__custom" style={wallpaperStyle} />
      <div className="wallpaper__orb wallpaper__orb--peach" /><div className="wallpaper__orb wallpaper__orb--blue" /><div className="wallpaper__orb wallpaper__orb--lilac" />
      <div className="wallpaper__horizon" />
    </div>
    <div className="wallpaper-overlay" style={{ opacity: workspace.settings.wallpaperOverlay / 100, backdropFilter: `blur(${workspace.settings.wallpaperBlur}px)` }} aria-hidden="true" />
    <div className="page-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Glass Home 首页" onClick={(event) => { event.preventDefault(); setEditMode(false); setSettingsTab(undefined); }}>
          <span className="brand__mark"><span /><span /><span /></span><span>Glass Home<span className="brand__badge">BETA</span></span>
        </a>
        <div className="topbar__right">
          <span className={`local-status local-status--${store.saveState}`} role="status" data-save-state={store.saveState}><span className="status-dot" />{store.saveState === 'saving' ? '正在保存到本地…' : store.saveState === 'error' ? '本地保存需要处理' : '一切就绪，只在本地'}</span>
          <button className="icon-button" aria-label="撤销布局" title="撤销布局" disabled={!store.canUndo || Boolean(store.preview)} onClick={() => void store.undoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '撤销失败。'))}><Undo2 size={17} /></button>
          <button className="icon-button" aria-label="重做布局" title="重做布局" disabled={!store.canRedo || Boolean(store.preview)} onClick={() => void store.redoLayout().catch((error: unknown) => store.reportError(error instanceof Error ? error.message : '重做失败。'))}><Redo2 size={17} /></button>
          <button className="icon-button" aria-label="打开设置" title="设置" onClick={() => setSettingsTab('appearance')}><Settings2 size={18} /></button>
          <span className="topbar__divider" /><span className="topbar__monogram" aria-hidden="true">G</span>
        </div>
      </header>
      <main id="main-content" className="main-layout">
        <div className="home-content">
          {store.preview && <div className="layout-preview-banner" role="status">正在预览未保存的布局；按 Esc 取消。</div>}
          <HomeGrid workspace={store.displayWorkspace ?? workspace} columns={store.columns} editMode={editMode}
            environment={{
              theme: themeDark ? 'dark' : 'light',
              language: document.documentElement.lang || 'zh-CN',
              reducedMotion: workspace.settings.reducedMotion,
              materialQuality: workspace.settings.materialQuality,
            }}
            widgetStorage={store.widgetStorage}
            onChooseSearchEngine={() => setSettingsTab('search')}
            onEditShortcut={setEditingShortcut}
            onDuplicateShortcut={duplicateShortcut}
            onRemoveShortcut={setRemovingShortcut}
            onPreviewLayout={store.previewLayout}
            onCommitLayout={store.commitLayoutPreview}
            onCancelLayout={store.cancelLayoutPreview}
            onWidgetError={(_instanceId, message) => store.reportError(message)}
          />
          {workspace.shortcuts.length === 0 && <div className="empty-state glass-surface"><h2>从这里，开始你的空间</h2><p>还没有快捷方式。添加常用网站，让主屏幕更像你。</p><button className="button button--primary" onClick={() => setEditingShortcut(null)}><Plus size={16} />添加快捷方式</button></div>}
          {editMode && <LayoutInspector workspace={workspace} displayWorkspace={store.displayWorkspace ?? workspace} columns={store.columns} preview={store.preview} onPreview={store.previewLayout} onCancel={store.cancelLayoutPreview} onCommit={store.commitLayoutPreview} />}
        </div>
      </main>
      <footer className="bottom-bar">
        <div className="bottom-bar__left"><Sparkles size={14} /><span>{editMode ? '拖动图标或组件即可调整布局；选中后方向键微调，Alt+方向键改尺寸。' : '少一点干扰，多一点专注。拖动图标可调整布局。'}</span></div>
        <div className="bottom-bar__right">
          {!editMode ? <button className="edit-button glass-control" onClick={() => setEditMode(true)}><LayoutGrid size={15} />编辑主屏幕</button> : <button className="done-button" onClick={() => setEditMode(false)}><Check size={16} />完成</button>}
          <button className="icon-button add-button" aria-label="添加快捷方式" title="添加快捷方式" onClick={() => setEditingShortcut(null)}><Plus size={20} /></button>
        </div>
      </footer>
    </div>
    {editMode && <div className="sr-only" role="status">已进入编辑模式。可以编辑快捷方式，或在布局内核验收面板选择目标格、预览并保存布局。</div>}
    {(store.saveError || store.notice) && <div className={`toast ${store.saveError ? 'toast--error' : ''}`} role={store.saveError ? 'alert' : 'status'}><span>{store.saveError ?? store.notice}</span>{store.saveError && <button onClick={store.clearError} aria-label="关闭错误提示">×</button>}</div>}
    {editingShortcut !== undefined && <ShortcutEditor shortcut={editingShortcut ?? undefined} defaultTarget={workspace.settings.openTarget} onSave={saveShortcut} onClose={() => setEditingShortcut(undefined)} />}
    {settingsTab && <SettingsPanel settings={workspace.settings} initialTab={settingsTab} wallpaperUrl={store.wallpaperUrl} busy={busy} onSave={saveSettings} onClose={() => setSettingsTab(undefined)} onExport={async () => downloadBackup(await exportBackup(workspace, store.assets))} onImport={importWorkspace} onReset={() => setResetConfirm(true)} />}
    {removingShortcut && <ConfirmDialog title={`删除「${removingShortcut.title}」？`} description="将从所有断点移除此快捷方式。不会删除任何浏览记录或网站数据。" confirmLabel="删除快捷方式" dangerous onClose={() => setRemovingShortcut(undefined)} onConfirm={() => { void store.commit(removeShortcut(workspace, removingShortcut.id), '快捷方式已删除。').catch(() => undefined); setRemovingShortcut(undefined); }} />}
    {resetConfirm && <ConfirmDialog title="恢复默认主屏幕？" description="此操作会替换你的设置、布局、快捷方式和本地壁纸。建议先导出备份。" confirmLabel="恢复默认" dangerous onClose={() => setResetConfirm(false)} onConfirm={() => { setResetConfirm(false); void store.reset(createDefaultWorkspace()).catch((error: unknown) => store.reportError(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请重试。')); }} />}
  </div>;
}
