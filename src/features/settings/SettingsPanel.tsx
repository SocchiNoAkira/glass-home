import { useRef, useState } from 'react';
import { Download, ImagePlus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/src/components/Modal';
import type { WorkspaceAsset, WorkspaceSettings } from '@/src/domain/workspace/model';
import { validateSearchTemplate } from '@/src/domain/search/search';
import { validateImageFile } from '@/src/infrastructure/persistence/assetRepository';
import { Diagnostics } from './Diagnostics';

export type SettingsTab = 'appearance' | 'search' | 'time' | 'data';

export function SettingsPanel({ settings, initialTab = 'appearance', wallpaperUrl, busy, onSave, onClose, onExport, onImport, onReset }: {
  readonly settings: WorkspaceSettings;
  readonly initialTab?: SettingsTab;
  readonly wallpaperUrl?: string | undefined;
  readonly busy: boolean;
  readonly onSave: (settings: WorkspaceSettings, asset?: WorkspaceAsset) => Promise<void>;
  readonly onClose: () => void;
  readonly onExport: () => Promise<void>;
  readonly onImport: (file: File) => Promise<void>;
  readonly onReset: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState(settings);
  const [pendingAsset, setPendingAsset] = useState<WorkspaceAsset>();
  const [preview, setPreview] = useState(wallpaperUrl);
  const [error, setError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const wallpaperRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

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

  return <Modal title="设置" eyebrow="MAKE IT YOURS" onClose={onClose} className="settings-modal">
    <div className="settings-tabs" role="tablist" aria-label="设置分类">
      {([['appearance', '外观'], ['search', '搜索'], ['time', '时间与日历'], ['data', '数据']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'is-selected' : ''} onClick={() => { setTab(value); setError(undefined); }}>{label}</button>)}
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
        <h3>本地备份</h3><p className="settings-note">备份包含设置、三个断点的布局、快捷方式与自定义壁纸，不包含任何账号或浏览历史。</p>
        <div className="data-actions"><button className="button button--secondary" disabled={busy} onClick={() => void onExport().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '导出失败'))}><Download size={16} />导出备份</button><button className="button button--secondary" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />导入备份</button><input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '导入失败')); event.target.value = ''; }} /></div>
        <div className="danger-zone"><h3>恢复默认主屏幕</h3><p>需要二次确认。此操作会替换当前设置、布局、快捷方式和本地壁纸。</p><button className="button button--danger button--small" disabled={busy} onClick={onReset}><RotateCcw size={15} />恢复默认</button></div>
        <Diagnostics />
      </div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tab !== 'data' ? <div className="modal__actions"><span className="save-hint">设置将保存在此浏览器中</span><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button type="button" className="button button--primary" onClick={() => void save()} disabled={busy}>保存设置</button></div> : <div className="modal__actions"><span className="save-hint"><Trash2 size={13} />清理入口只影响 Glass Home 数据</span><button type="button" className="button button--secondary" onClick={onClose}>完成</button></div>}
  </Modal>;
}
