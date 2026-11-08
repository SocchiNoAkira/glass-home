import { useState } from 'react';
import { Modal } from '@/src/components/Modal';
import type { Shortcut } from '@/src/domain/workspace/model';
import { fallbackIcon, SHORTCUT_COLORS, validateShortcut } from '@/src/domain/shortcuts/shortcut';

export interface ShortcutDraft {
  readonly title: string;
  readonly url: string;
  readonly icon: string;
  readonly accentColor: string;
  readonly openTarget: 'current' | 'new';
}

export function ShortcutEditor({ shortcut, defaultTarget, onSave, onClose }: {
  readonly shortcut?: Shortcut | undefined;
  readonly defaultTarget: 'current' | 'new';
  readonly onSave: (draft: ShortcutDraft, shortcut?: Shortcut) => void;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState<ShortcutDraft>({
    title: shortcut?.title ?? '', url: shortcut?.url ?? '', icon: shortcut?.icon ?? '',
    accentColor: shortcut?.accentColor ?? SHORTCUT_COLORS[0], openTarget: shortcut?.openTarget ?? defaultTarget,
  });
  const [error, setError] = useState<string>();
  const update = <K extends keyof ShortcutDraft>(key: K, value: ShortcutDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = { ...draft, title: draft.title.trim(), url: draft.url.trim(), icon: draft.icon.trim() || fallbackIcon(draft.title) };
    const validationError = validateShortcut(normalized.title, normalized.url);
    if (validationError) { setError(validationError); return; }
    onSave(normalized, shortcut);
  };

  return (
    <Modal title={shortcut ? '编辑快捷方式' : '添加快捷方式'} eyebrow="YOUR SHORTCUT" onClose={onClose} className="shortcut-editor">
      <form onSubmit={submit}>
        <div className="shortcut-editor__preview">
          <span className="shortcut__icon" style={{ background: draft.accentColor }}>{draft.icon || fallbackIcon(draft.title)}</span>
          <div><strong>{draft.title || '新的快捷方式'}</strong><p>每个图标都是独立的网格对象</p></div>
        </div>
        <label className="field"><span>名称</span><input required maxLength={40} value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：GitHub" autoFocus /></label>
        <label className="field"><span>网址</span><input required type="url" maxLength={2048} value={draft.url} onChange={(event) => update('url', event.target.value)} placeholder="https://example.com" inputMode="url" /></label>
        <label className="field"><span>图标文字 <small>留空时使用名称首字，不请求第三方图标服务</small></span><input maxLength={4} value={draft.icon} onChange={(event) => update('icon', event.target.value)} placeholder={fallbackIcon(draft.title)} /></label>
        <fieldset className="field"><legend>图标颜色</legend><div className="color-options">{SHORTCUT_COLORS.map((color) => <button type="button" key={color} className={`color-swatch ${draft.accentColor === color ? 'is-selected' : ''}`} style={{ background: color }} onClick={() => update('accentColor', color)} aria-label={`图标颜色 ${color}`} aria-pressed={draft.accentColor === color} />)}</div></fieldset>
        <label className="field"><span>打开方式</span><select value={draft.openTarget} onChange={(event) => update('openTarget', event.target.value as 'current' | 'new')}><option value="new">新标签页打开</option><option value="current">当前标签页打开</option></select></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal__actions"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button type="submit" className="button button--primary">{shortcut ? '保存更改' : '添加到主屏幕'}</button></div>
      </form>
    </Modal>
  );
}
