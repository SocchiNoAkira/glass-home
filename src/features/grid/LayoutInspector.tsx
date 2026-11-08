import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Check, Eye, Lock, LockOpen, Sparkles, X } from 'lucide-react';
import { constraintsForItem, readingOrder, type GridColumns } from '@/src/domain/grid/model';
import { layoutHeight } from '@/src/domain/grid/occupancy';
import type { Workspace } from '@/src/domain/workspace/model';
import type { LayoutTransaction } from '@/src/domain/layout/transaction';
import type { LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';

export function LayoutInspector({ workspace, displayWorkspace, columns, preview, onPreview, onCancel, onCommit }: {
  readonly workspace: Workspace;
  readonly displayWorkspace: Workspace;
  readonly columns: GridColumns;
  readonly preview?: LayoutTransaction | undefined;
  readonly onPreview: (breakpoint: GridColumns, command: LayoutCommand, preference?: LayoutPreference) => boolean;
  readonly onCancel: () => void;
  readonly onCommit: () => Promise<void>;
}) {
  const items = useMemo(() => readingOrder(workspace.layouts[columns]), [workspace, columns]);
  const [instanceId, setInstanceId] = useState('github');
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preference, setPreference] = useState<LayoutPreference>('auto');
  const item = items.find((entry) => entry.instanceId === instanceId) ?? items[0];

  useEffect(() => {
    if (!item) return;
    setX(item.x);
    setY(item.y);
  }, [item?.instanceId, item?.x, item?.y]);

  if (!item) return null;
  const constraint = constraintsForItem(item);
  const previewChanged = preview ? preview.after.filter((after) => {
    const before = preview.before.find((entry) => entry.instanceId === after.instanceId);
    return before && (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h || before.locked !== after.locked);
  }) : [];
  const previewLabel = preview?.operation === 'swap' ? '交换' : preview?.operation === 'push' ? '推挤' : preview?.operation === 'resize' ? '调整尺寸' : preview?.operation === 'lock' ? '锁定状态' : preview?.operation === 'compact' ? '紧凑整理' : preview?.operation === 'reflow' ? '局部重排' : '移动';
  // Baseline 6.11 requires the height change to be visible before confirming.
  const heightBefore = preview ? layoutHeight(preview.before) : 0;
  const heightAfter = preview ? layoutHeight(preview.after) : 0;
  const heightDelta = heightAfter - heightBefore;

  return <section className="layout-inspector glass-surface" aria-label="布局内核验收">
    <div className="layout-inspector__heading"><div><span className="eyebrow">LAYOUT ENGINE · 2B</span><h2>布局预览与事务</h2></div><span className="layout-inspector__badge">目标格与整理</span></div>
    <p className="settings-note">选择对象与目标格，先预览再保存。拖动时若推挤找不到位置会自动尝试局部重排；紧凑整理会压缩整页空白，改动范围较大，确认前请核对影响数量。</p>
    <div className="layout-inspector__controls">
      <label htmlFor="layout-object">对象<select id="layout-object" value={item.instanceId} onChange={(event) => setInstanceId(event.target.value)} disabled={Boolean(preview) || busy}>
        {items.map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.kind === 'widget' ? '组件 · ' : ''}{workspace.shortcuts.find((shortcut) => shortcut.id === entry.instanceId)?.title ?? entry.instanceId.replace('builtin.', '')}</option>)}
      </select></label>
      <label htmlFor="layout-x">列 X<input id="layout-x" type="number" min={0} max={columns - item.w} step={1} value={x} onChange={(event) => setX(Number(event.target.value))} disabled={Boolean(preview) || busy} /></label>
      <label htmlFor="layout-y">行 Y<input id="layout-y" type="number" min={0} max={100} step={1} value={y} onChange={(event) => setY(Number(event.target.value))} disabled={Boolean(preview) || busy} /></label>
      <label htmlFor="layout-preference">冲突处理<select id="layout-preference" value={preference} onChange={(event) => setPreference(event.target.value as LayoutPreference)} disabled={Boolean(preview) || busy}>
        <option value="auto">自动 · 优先交换</option><option value="push-first">推挤链</option>
      </select></label>
      <button className="button button--secondary" disabled={Boolean(preview) || busy || item.locked} onClick={() => onPreview(columns, { type: 'move', instanceId: item.instanceId, target: { x, y, w: item.w, h: item.h } }, preference)}><Eye size={15} />生成预览</button>
    </div>
    <div className="layout-inspector__meta">
      <span>当前：({item.x}, {item.y}) · {item.w}×{item.h}</span>
      <label htmlFor="layout-size">尺寸预设<select id="layout-size" value={`${item.w}x${item.h}`} disabled={Boolean(preview) || busy || item.locked} onChange={(event) => { const [w, h] = event.target.value.split('x').map(Number); onPreview(columns, { type: 'resize', instanceId: item.instanceId, target: { x: item.x, y: item.y, w: w!, h: h! } }); }}>
        {constraint.presets.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w}×{h}</option>)}
      </select></label>
      <button className="button button--secondary button--small" disabled={Boolean(preview) || busy} onClick={() => onPreview(columns, { type: 'set-lock', instanceId: item.instanceId, locked: !item.locked })}>{item.locked ? <><Lock size={13} />解锁对象</> : <><LockOpen size={13} />锁定对象</>}</button>
    </div>
    <div className="layout-inspector__compact">
      <button id="layout-compact" className="button button--secondary" disabled={Boolean(preview) || busy || items.every((entry) => entry.locked)} onClick={() => onPreview(columns, { type: 'compact' })}>
        <Sparkles size={15} />紧凑整理
      </button>
      <small>按阅读顺序向上、向左压缩，大对象先定位、锁定对象保持原位、不改变任何尺寸。这会重排多数对象，请先看下面预览的影响数量与高度变化再确认。</small>
    </div>
    {preview && <div className="layout-preview" role="status" data-preview-id={preview.transactionId}>
      <div><strong>预览：{previewLabel} · 影响 {previewChanged.length} 个对象</strong><p>{previewChanged.slice(0, 6).map((entry) => `${entry.instanceId} → (${entry.x}, ${entry.y}) ${entry.w}×${entry.h}`).join('；')}{previewChanged.length > 6 ? '…' : ''}</p><small>页面高度：{heightBefore} → {heightAfter} 行{heightDelta === 0 ? '（不变）' : heightDelta > 0 ? `（增加 ${heightDelta} 行）` : `（减少 ${-heightDelta} 行）`}。尚未保存。其他断点和实体配置不变；Esc 取消整个预览。</small></div>
      <div className="layout-preview__actions"><button className="button button--primary" disabled={busy} onClick={() => { setBusy(true); void onCommit().catch(() => undefined).finally(() => setBusy(false)); }}><Check size={15} />确认并保存</button><button className="button button--secondary" disabled={busy} onClick={onCancel}><X size={15} />取消</button></div>
    </div>}
    <div className="layout-inspector__hint"><ArrowDownToLine size={13} /> 推挤失败会自动尝试局部重排；两者都失败时保留完整旧布局。</div>
    <span className="sr-only" aria-live="polite">{displayWorkspace === workspace ? '' : '正在显示未保存的布局预览。'}</span>
  </section>;
}
