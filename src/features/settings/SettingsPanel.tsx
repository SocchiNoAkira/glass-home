import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eraser, ImagePlus, RotateCcw, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/src/components/Modal';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import type { WorkspaceAsset, WorkspaceSettings } from '@/src/domain/workspace/model';
import { validateSearchTemplate } from '@/src/domain/search/search';
import { validateImageFile } from '@/src/infrastructure/persistence/assetRepository';
import { Diagnostics } from './Diagnostics';
import { SandboxDemo } from './SandboxDemo';

export type SettingsTab = 'appearance' | 'search' | 'time' | 'data';

/** Display names for the built-in widgets; an unknown id falls back to itself. */
const WIDGET_LABELS: Readonly<Record<string, string>> = {
  'builtin.clock': '时钟',
  'builtin.search': '搜索',
  'builtin.calendar': '日历',
  'builtin.todo': '待办',
};

export interface WidgetDataEntry {
  readonly instanceId: string;
  readonly namespace: string;
  readonly bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsPanel({ settings, initialTab = 'appearance', wallpaperUrl, busy, widgetData, onSave, onClose, onExport, onImport, onReset, onClearWidgetData, onClearAllData, onRequestWidgetData }: {
  readonly settings: WorkspaceSettings;
  readonly initialTab?: SettingsTab;
  readonly wallpaperUrl?: string | undefined;
  readonly busy: boolean;
  /** Stored data per widget instance, shown so a clear is a reasoned action. */
  readonly widgetData: readonly WidgetDataEntry[];
  readonly onSave: (settings: WorkspaceSettings, asset?: WorkspaceAsset) => Promise<void>;
  readonly onClose: () => void;
  readonly onExport: () => Promise<void>;
  readonly onImport: (file: File) => Promise<void>;
  readonly onReset: () => void;
  readonly onClearWidgetData: (namespace: string) => Promise<void>;
  readonly onClearAllData: () => Promise<void>;
  /**
   * Asks the host to re-measure widget usage.
   *
   * The panel can be opened straight onto another tab and switched to "数据"
   * from inside, which the host cannot observe — without this, the list renders
   * stale zeros and every clear button stays disabled.
   */
  readonly onRequestWidgetData?: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState(settings);
  const [pendingAsset, setPendingAsset] = useState<WorkspaceAsset>();
  const [preview, setPreview] = useState(wallpaperUrl);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingClear, setPendingClear] = useState<WidgetDataEntry | 'all'>();
  const [clearing, setClearing] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const wallpaperRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

  /**
   * Whether the draft differs from what is actually persisted.
   *
   * The 数据 tab used to offer only "完成", which closed the panel outright.
   * A user who adjusted 主题 on the 外观 tab, then moved to 数据 to check usage
   * and pressed 完成, lost those edits with no warning. Unsaved changes are now
   * detected so the close path can ask instead of silently discarding.
   */
  const dirty = useMemo(
    () => (Object.keys(settings) as (keyof WorkspaceSettings)[]).some((key) => draft[key] !== settings[key]) || pendingAsset !== undefined,
    [draft, settings, pendingAsset],
  );

  // Opening straight onto the data tab must measure too, not only switching
  // into it later. Done in an effect rather than during render: calling back
  // into the host from render would set state mid-render, which React rejects.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (initialTab !== 'data' || requestedRef.current) return;
    requestedRef.current = true;
    onRequestWidgetData?.();
  }, [initialTab, onRequestWidgetData]);

  const save = async () => {
    if (draft.searchEngine === 'custom') {
      const templateError = validateSearchTemplate(draft.customSearchTemplate);
      if (templateError) { setError(templateError); return; }
    }
    try {
      await onSave(draft, pendingAsset);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '设置保存失败，请重试。');
    }
  };

  const selectWallpaper = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    try {
      const asset = await validateImageFile(file);
      setPendingAsset(asset);
      setPreview(URL.createObjectURL(asset.blob));
      update('wallpaperAssetId', asset.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取图片。');
    } finally {
      if (wallpaperRef.current) wallpaperRef.current.value = '';
    }
  };

  const confirmClear = async () => {
    const target = pendingClear;
    if (!target) return;
    setClearing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (target === 'all') await onClearAllData();
      else await onClearWidgetData(target.namespace);
      setNotice(target === 'all'
        ? '已清除全部本地数据，正在重新加载。'
        : `已清除「${WIDGET_LABELS[target.instanceId] ?? target.instanceId}」的组件数据。`);
      setPendingClear(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除失败，请重试。');
    } finally {
      setClearing(false);
    }
  };

  return <Modal title="设置" eyebrow="MAKE IT YOURS" onClose={onClose} className="settings-modal">
    <div className="settings-tabs" role="tablist" aria-label="设置分类">
      {([['appearance', '外观'], ['search', '搜索'], ['time', '时间与日历'], ['data', '数据']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'is-selected' : ''} onClick={() => { setTab(value); setError(undefined); setNotice(undefined); if (value === 'data') onRequestWidgetData?.(); }}>{label}</button>)}
    </div>
    <div className="settings-content">
      {tab === 'appearance' && <div className="settings-section" role="tabpanel" aria-label="外观设置">
        <div className="settings-row"><label htmlFor="theme">外观</label><select id="theme" value={draft.theme} onChange={(event) => update('theme', event.target.value as WorkspaceSettings['theme'])}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div>
        <div className="settings-row"><label htmlFor="material">材质质量</label><select id="material" value={draft.materialQuality} onChange={(event) => update('materialQuality', event.target.value as WorkspaceSettings['materialQuality'])}><option value="high">高 · 完整模糊与高光</option><option value="balanced">均衡 · 推荐</option><option value="low">低 · 轻量材质</option><option value="off">关闭 · 实体表面</option></select></div>
        <div className="settings-row"><span>减少动态效果</span><button className={`switch ${draft.reducedMotion ? 'is-on' : ''}`} role="switch" aria-checked={draft.reducedMotion} aria-label="减少动态效果" onClick={() => update('reducedMotion', !draft.reducedMotion)}><span /></button></div>
        <fieldset className="settings-group"><legend>渐变壁纸</legend><div className="wallpaper-options">{(['dawn', 'dusk', 'sage'] as const).map((gradient) => <button key={gradient} type="button" className={`wallpaper-option wallpaper-option--${gradient} ${draft.wallpaperGradient === gradient && !draft.wallpaperAssetId ? 'is-selected' : ''}`} onClick={() => { update('wallpaperAssetId', null); update('wallpaperGradient', gradient); setPendingAsset(undefined); setPreview(undefined); }} aria-label={`${gradient === 'dawn' ? '晨曦' : gradient === 'dusk' ? '暮色' : '苔原'}渐变`} aria-pressed={draft.wallpaperGradient === gradient && !draft.wallpaperAssetId} />)}</div></fieldset>
        <div className="settings-row"><span>自定义壁纸 <small>图片仅保存在本地，最大 4MB</small></span><button type="button" className="button button--secondary button--small" onClick={() => wallpaperRef.current?.click()}><ImagePlus size={15} />选择图片</button><input ref={wallpaperRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectWallpaper(event.target.files?.[0])} /></div>
        {preview && <div className="wallpaper-preview" style={{ backgroundImage: `url(${JSON.stringify(preview).slice(1, -1)})` }} aria-label="自定义壁纸预览" />}
        <label className="range-field"><span>背景模糊 <output>{draft.wallpaperBlur}px</output></span><input type="range" min="0" max="30" value={draft.wallpaperBlur} onChange={(event) => update('wallpaperBlur', Number(event.target.value))} /></label>
        <label className="range-field"><span>明暗遮罩 <output>{draft.wallpaperOverlay}%</output></span><input type="range" min="0" max="70" value={draft.wallpaperOverlay} onChange={(event) => update('wallpaperOverlay', Number(event.target.value))} /></label>
      </div>}
      {tab === 'search' && <div className="settings-section" role="tabpanel" aria-label="搜索设置">
        <label className="field" htmlFor="search-engine"><span>搜索引擎</span><select id="search-engine" value={draft.searchEngine} onChange={(event) => update('searchEngine', event.target.value as WorkspaceSettings['searchEngine'])}><option value="google">Google</option><option value="bing">Bing</option><option value="baidu">百度</option><option value="duckduckgo">DuckDuckGo</option><option value="custom">自定义模板</option></select></label>
        {draft.searchEngine === 'custom' && <label className="field" htmlFor="custom-search-template"><span>搜索 URL 模板 <small>必须包含 {'{query}'}，仅支持 HTTP/HTTPS</small></span><input id="custom-search-template" value={draft.customSearchTemplate} onChange={(event) => update('customSearchTemplate', event.target.value)} placeholder="https://example.com/search?q={query}" spellCheck={false} /></label>}
        <label className="field" htmlFor="open-target"><span>结果打开方式</span><select id="open-target" value={draft.openTarget} onChange={(event) => update('openTarget', event.target.value as WorkspaceSettings['openTarget'])}><option value="new">新标签页</option><option value="current">当前标签页</option></select></label>
        <p className="settings-note">仅在你提交搜索时向所选服务发送关键词。联网搜索建议默认关闭；网址与自定义模板会经过安全协议校验。</p>
      </div>}
      {tab === 'time' && <div className="settings-section" role="tabpanel" aria-label="时间与日历设置">
        <label className="field" htmlFor="time-format"><span>时间格式</span><select id="time-format" value={draft.timeFormat} onChange={(event) => update('timeFormat', event.target.value as WorkspaceSettings['timeFormat'])}><option value="system">跟随系统</option><option value="12h">12 小时制</option><option value="24h">24 小时制</option></select></label>
        <label className="field" htmlFor="time-zone"><span>时区</span><select id="time-zone" value={draft.timeZone} onChange={(event) => update('timeZone', event.target.value)}><option value="system">跟随系统</option><option value="Asia/Shanghai">中国标准时间</option><option value="Asia/Tokyo">东京</option><option value="UTC">UTC</option><option value="Europe/London">伦敦</option><option value="America/New_York">纽约</option></select></label>
        <div className="settings-row"><span>显示秒</span><button className={`switch ${draft.showSeconds ? 'is-on' : ''}`} role="switch" aria-checked={draft.showSeconds} aria-label="显示秒" onClick={() => update('showSeconds', !draft.showSeconds)}><span /></button></div>
        <div className="settings-row"><span>显示日期</span><button className={`switch ${draft.showDate ? 'is-on' : ''}`} role="switch" aria-checked={draft.showDate} aria-label="显示日期" onClick={() => update('showDate', !draft.showDate)}><span /></button></div>
        <div className="settings-row"><span>显示星期</span><button className={`switch ${draft.showWeekday ? 'is-on' : ''}`} role="switch" aria-checked={draft.showWeekday} aria-label="显示星期" onClick={() => update('showWeekday', !draft.showWeekday)}><span /></button></div>
        <label className="field" htmlFor="calendar-mode"><span>默认日历模式</span><select id="calendar-mode" value={draft.calendarMode} onChange={(event) => update('calendarMode', event.target.value as WorkspaceSettings['calendarMode'])}><option value="compact">日期摘要</option><option value="month">完整月历</option></select></label>
        <label className="field" htmlFor="week-starts-on"><span>每周第一天</span><select id="week-starts-on" value={draft.weekStartsOn} onChange={(event) => update('weekStartsOn', Number(event.target.value) as 0 | 1)}><option value={1}>星期一</option><option value={0}>星期日</option></select></label>
      </div>}
      {tab === 'data' && <div className="settings-section" role="tabpanel" aria-label="数据管理">
        <h3>本地备份</h3><p className="settings-note">备份包含设置、三个断点的布局、快捷方式、自定义壁纸与组件数据（如待办清单）。不包含任何账号或浏览历史。</p>
        <div className="data-actions"><button className="button button--secondary" disabled={busy} onClick={() => void onExport().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '导出失败'))}><Download size={16} />导出备份</button><button className="button button--secondary" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />导入备份</button><input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '导入失败')); event.target.value = ''; }} /></div>

        {/* CLEAR-WIDGET-DATA: baseline 12.4 requires a per-widget clear entry. */}
        <section className="danger-zone" aria-label="组件数据">
          <h3>组件数据</h3>
          <p>每个组件的本地数据单独保存。清除不会移除该组件本身，只清空它的内容，例如待办清单。</p>
          <ul className="widget-data-list" data-testid="widget-data-list">
            {widgetData.map((entry) => <li key={entry.instanceId} className="widget-data-list__row" data-widget-namespace={entry.namespace}>
              <span className="widget-data-list__name">{WIDGET_LABELS[entry.instanceId] ?? entry.instanceId}</span>
              <span className="widget-data-list__size" data-widget-bytes={entry.bytes}>{formatBytes(entry.bytes)}</span>
              <button type="button" className="button button--secondary button--small" disabled={busy || clearing || entry.bytes === 0} onClick={() => { setError(undefined); setNotice(undefined); setPendingClear(entry); }}><Eraser size={14} />清除</button>
            </li>)}
          </ul>
        </section>

        <div className="danger-zone"><h3>恢复默认主屏幕</h3><p>需要二次确认。此操作会替换当前设置、布局、快捷方式和本地壁纸。</p><button className="button button--danger button--small" disabled={busy} onClick={onReset}><RotateCcw size={15} />恢复默认</button></div>

        {/* CLEAR-ALL-DATA: the other half of baseline 12.4. */}
        <div className="danger-zone danger-zone--destructive">
          <h3><ShieldAlert size={14} /> 清除全部数据</h3>
          <p>删除本机保存的工作区、自定义图片与全部组件数据，并重建一个空白主屏幕。此操作不可撤销，建议先导出备份。</p>
          <button type="button" className="button button--danger button--small" data-testid="clear-all-data" disabled={busy || clearing} onClick={() => { setError(undefined); setNotice(undefined); setPendingClear('all'); }}><Trash2 size={15} />清除全部数据</button>
        </div>

        <Diagnostics />
        <SandboxDemo environment={{
          theme: draft.theme === 'light' ? 'light' : 'dark',
          language: document.documentElement.lang || 'zh-CN',
          reducedMotion: draft.reducedMotion,
          materialQuality: draft.materialQuality,
        }} />
      </div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-notice" role="status" data-testid="settings-notice">{notice}</p>}
    {/*
      The 数据 tab keeps a "完成" close, but it no longer discards silently:
      with pending edits it routes through a confirm first, and offers saving
      directly so a user who changed 外观 and wandered here does not have to
      navigate back to save.
    */}
    {tab !== 'data' ? <div className="modal__actions"><span className="save-hint">设置将保存在此浏览器中</span><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button type="button" className="button button--primary" onClick={() => void save()} disabled={busy}>保存设置</button></div> : <div className="modal__actions">
      <span className="save-hint"><Trash2 size={13} />清理入口只影响 Glass Home 数据</span>
      {dirty ? <><button type="button" className="button button--secondary" disabled={busy} onClick={() => setDiscardConfirm(true)}>放弃修改</button><button type="button" className="button button--primary" disabled={busy} onClick={() => void save()}>保存设置</button></> : <button type="button" className="button button--secondary" onClick={onClose}>完成</button>}
    </div>}

    {discardConfirm && <ConfirmDialog
      title="放弃未保存的修改？"
      description="你在其它分页做过的设置改动还没有保存，关闭面板会丢弃它们。"
      confirmLabel="放弃修改"
      dangerous
      onClose={() => setDiscardConfirm(false)}
      onConfirm={() => { setDiscardConfirm(false); onClose(); }}
    />}
    {pendingClear === 'all' && <ConfirmDialog
      title="清除全部本地数据？"
      description="将删除工作区、自定义图片和全部组件数据，并重建空白主屏幕。此操作不可撤销。"
      confirmLabel="清除全部数据"
      dangerous
      onClose={() => setPendingClear(undefined)}
      onConfirm={() => void confirmClear()}
    />}
    {pendingClear !== undefined && pendingClear !== 'all' && <ConfirmDialog
      title={`清除「${WIDGET_LABELS[pendingClear.instanceId] ?? pendingClear.instanceId}」的组件数据？`}
      description="将删除该组件在本机保存的全部数据。组件本身与布局位置保持不变，此操作不可撤销。"
      confirmLabel="清除组件数据"
      dangerous
      onClose={() => setPendingClear(undefined)}
      onConfirm={() => void confirmClear()}
    />}
  </Modal>;
}
