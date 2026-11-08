import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';
import { readingOrder } from '@/src/domain/grid/model';
import type { Shortcut, Workspace } from '@/src/domain/workspace/model';
import type { LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';
import { cellStrideX, cellStrideY } from '@/src/domain/interaction/dragGeometry';
import type { DropIntent } from '@/src/domain/interaction/dragIntent';
import { dropIntentKindLabel } from '@/src/domain/interaction/dragIntent';
import { ClockWidget } from '@/src/features/clock/ClockWidget';
import { CalendarWidget } from '@/src/features/calendar/CalendarWidget';
import { SearchWidget } from '@/src/features/search/SearchWidget';
import { ShortcutIcon } from '@/src/features/shortcuts/ShortcutIcon';
import { useGridDrag } from './useGridDrag';
import { useGridKeyboard } from './useGridKeyboard';

/** Absolute CSS pixel rectangle for one grid rect, derived from the one-off measurement. */
function rectToPixels(metrics: GridMetrics, rect: Readonly<{ x: number; y: number; w: number; h: number }>) {
  return {
    left: metrics.padLeft + rect.x * cellStrideX(metrics),
    top: metrics.padTop + rect.y * cellStrideY(metrics),
    width: rect.w * metrics.cellWidth + Math.max(0, rect.w - 1) * metrics.gapX,
    height: rect.h * metrics.rowHeight + Math.max(0, rect.h - 1) * metrics.gapY,
  };
}

function DragOverlay({ metrics, origin, intent }: {
  readonly metrics: GridMetrics;
  readonly origin: Readonly<{ x: number; y: number; w: number; h: number }>;
  readonly intent: DropIntent;
}) {
  const slot = rectToPixels(metrics, origin);
  const target = rectToPixels(metrics, intent.target);
  return <>
    <div className="drag-origin-slot" aria-hidden="true" style={slot} />
    <div className={`drag-target drag-target--${intent.kind}`} style={target} />
    {/* The label is a sibling, not a child: the carried item sits above the
        outline, so a nested label would be covered by the icon it describes. */}
    <span className="drag-target__label" style={{ left: target.left, top: target.top }} role="status" aria-live="polite">
      {dropIntentKindLabel(intent)}
    </span>
  </>;
}

export function HomeGrid({ workspace, columns, editMode, onChooseSearchEngine, onEditShortcut, onDuplicateShortcut, onRemoveShortcut, onPreviewLayout, onCommitLayout, onCancelLayout }: {
  readonly workspace: Workspace;
  readonly columns: GridColumns;
  readonly editMode: boolean;
  readonly onChooseSearchEngine: () => void;
  readonly onEditShortcut: (shortcut: Shortcut) => void;
  readonly onDuplicateShortcut: (shortcut: Shortcut) => void;
  readonly onRemoveShortcut: (shortcut: Shortcut) => void;
  readonly onPreviewLayout: (columns: GridColumns, command: LayoutCommand, preference?: LayoutPreference) => boolean;
  readonly onCommitLayout: () => Promise<void>;
  readonly onCancelLayout: () => void;
}) {
  const shortcuts = new Map(workspace.shortcuts.map((shortcut) => [shortcut.id, shortcut]));
  const items = readingOrder(workspace.layouts[columns]);

  const drag = useGridDrag({
    columns,
    layout: items,
    preview: onPreviewLayout,
    commit: onCommitLayout,
    cancel: onCancelLayout,
  });

  const keyboard = useGridKeyboard({
    columns,
    layout: items,
    preview: onPreviewLayout,
    commit: onCommitLayout,
  });

  const renderItem = (item: LayoutItem) => {
    if (item.instanceId === 'builtin.clock') return <ClockWidget settings={workspace.settings} />;
    if (item.instanceId === 'builtin.search') return <SearchWidget settings={workspace.settings} onChooseEngine={onChooseSearchEngine} />;
    if (item.instanceId === 'builtin.calendar') return <CalendarWidget settings={workspace.settings} />;
    const shortcut = shortcuts.get(item.instanceId);
    if (!shortcut) return <div className="grid-error" role="alert">快捷方式数据缺失</div>;
    return <ShortcutIcon shortcut={shortcut} editMode={editMode} onEdit={onEditShortcut} onDuplicate={onDuplicateShortcut} onRemove={onRemoveShortcut} />;
  };

  const dragging = drag.instanceId;

  return (
    <div
      ref={drag.gridRef}
      className={`unified-grid unified-grid--${columns} ${editMode ? 'unified-grid--editing' : ''} ${dragging ? 'unified-grid--dragging' : ''}`}
      data-testid="unified-grid" data-columns={columns}
      style={{ '--grid-columns': columns } as React.CSSProperties}
      aria-label={`主屏幕统一网格，${columns} 列`}
      data-drag-instance={dragging}
      data-drag-intent={drag.intent?.kind}
      {...drag.handlers}
    >
      {items.map((item) => {
        // The lifted element is pinned to its origin cell while the preview is
        // free to rearrange everything else. Without this the preview's new
        // grid position and the pointer transform would stack, putting the
        // element one cell away from the pointer.
        const placement = item.instanceId === dragging && drag.origin ? drag.origin : item;
        return (
          <div
            key={item.instanceId}
            className={`grid-item grid-item--${item.instanceId.replaceAll('.', '-')} ${item.kind === 'widget' ? 'grid-item--widget' : 'grid-item--shortcut'} ${item.instanceId === dragging ? 'grid-item--dragging' : ''}`}
            style={{ gridColumn: `${placement.x + 1} / span ${placement.w}`, gridRow: `${placement.y + 1} / span ${placement.h}` }}
            data-instance-id={item.instanceId}
            data-grid-x={item.x} data-grid-y={item.y} data-grid-w={item.w} data-grid-h={item.h}
            data-dragging-pinned={item.instanceId === dragging && drag.origin ? 'true' : undefined}
            data-locked={item.locked ? 'true' : undefined}
            tabIndex={editMode && !item.locked ? 0 : undefined}
            onKeyDown={editMode ? keyboard.onKeyDown : undefined}
          >
            {renderItem(item)}
            {editMode && item.kind === 'widget' && <span className="grid-item__edit-badge" title={item.locked ? '已锁定，不能拖动' : '拖动可移动'}>{item.locked ? '已锁定' : '组件'}</span>}
          </div>
        );
      })}
      {drag.metrics && drag.origin && drag.intent && <DragOverlay metrics={drag.metrics} origin={drag.origin} intent={drag.intent} />}
    </div>
  );
}
