import { useLayoutEffect, useState } from 'react';
import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';
import { readingOrder } from '@/src/domain/grid/model';
import type { Shortcut, Workspace } from '@/src/domain/workspace/model';
import type { LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';
import type { GridMetrics } from '@/src/domain/interaction/dragGeometry';
import { cellStrideX, cellStrideY } from '@/src/domain/interaction/dragGeometry';
import type { DropIntent } from '@/src/domain/interaction/dragIntent';
import { dropIntentKindLabel } from '@/src/domain/interaction/dragIntent';
import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import { widgetCatalogEntry } from '@/src/domain/widget/catalog';
import type { WidgetStorage } from '@/src/infrastructure/persistence/widgetStorage';
import { ShortcutIcon } from '@/src/features/shortcuts/ShortcutIcon';
import { WidgetHost } from '@/src/features/widget/WidgetHost';
import { WidgetEditBadge } from './EditBadges';
import { measureGridMetrics } from './gridMetrics';
import { gridCellTexture } from './gridTexture';
import { useGridDrag } from './useGridDrag';
import { useGridKeyboard } from './useGridKeyboard';

/** Display name for a widget, from the one catalog the gallery also reads. */
function widgetLabel(instanceId: string): string {
  return widgetCatalogEntry(instanceId)?.label ?? instanceId;
}

/** Whether two measurements describe the same rendered tracks. */
function sameMetrics(a: GridMetrics | undefined, b: GridMetrics | undefined): boolean {
  if (!a || !b) return a === b;
  return a.columns === b.columns
    && a.cellWidth === b.cellWidth
    && a.rowHeight === b.rowHeight
    && a.gapX === b.gapX
    && a.gapY === b.gapY
    && a.padLeft === b.padLeft
    && a.padTop === b.padTop;
}

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

export function HomeGrid({ workspace, columns, editMode, environment, widgetStorage, widgetDataVersion, onEditShortcut, onDuplicateShortcut, onRemoveShortcut, onPreviewLayout, onCommitLayout, onCancelLayout, onWidgetError, onRemoveWidget }: {
  readonly workspace: Workspace;
  readonly columns: GridColumns;
  readonly editMode: boolean;
  /** Host-level widget environment (theme, language, motion, material). */
  readonly environment: Omit<WidgetEnvironment, 'size'>;
  readonly widgetStorage: WidgetStorage | undefined;
  /** Bumped when widget data is cleared outside a widget, to force a re-read. */
  readonly widgetDataVersion: number;
  readonly onEditShortcut: (shortcut: Shortcut) => void;
  readonly onDuplicateShortcut: (shortcut: Shortcut) => void;
  readonly onRemoveShortcut: (shortcut: Shortcut) => void;
  readonly onPreviewLayout: (columns: GridColumns, command: LayoutCommand, preference?: LayoutPreference) => boolean;
  readonly onCommitLayout: () => Promise<void>;
  readonly onCancelLayout: () => void;
  readonly onWidgetError: (instanceId: string, message: string) => void;
  /** Opens the removal confirmation in `App`; the grid never writes by itself. */
  readonly onRemoveWidget: (instanceId: string) => void;
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

  /**
   * Real track geometry, measured after layout so the texture can align to it.
   *
   * Row height and both gutters differ per breakpoint (92 / 82 / 76px rows, and
   * the 420px breakpoint changes rows without changing the column count), so
   * they must be read from the rendered grid rather than hard-coded. The same
   * `measureGridMetrics` the hit tester uses feeds the texture, which is what
   * keeps "the square you see" and "the cell you can drop into" identical.
   *
   * Measured unconditionally, not only in edit mode: a drag in normal mode makes
   * the texture appear mid-interaction, and measuring on drag start would paint
   * one frame with stale geometry.
   */
  const [metrics, setMetrics] = useState<GridMetrics>();
  useLayoutEffect(() => {
    const grid = drag.gridRef.current;
    if (!grid) return;
    const measure = () => {
      const next = measureGridMetrics(grid, columns);
      setMetrics((previous) => (sameMetrics(previous, next) ? previous : next));
    };
    measure();
    // Breakpoint changes that do not alter the column count (row height, gaps)
    // still have to be picked up, so the resize event is the trigger.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [columns, editMode, drag.gridRef]);

  const renderItem = (item: LayoutItem) => {
    // Widgets go through the host so error isolation and the environment
    // handoff are identical for every built-in, including the to-do widget.
    if (item.kind === 'widget') {
      return <WidgetHost
        item={item}
        workspace={workspace}
        environment={{ ...environment, size: { w: item.w, h: item.h } }}
        storage={widgetStorage}
        widgetDataVersion={widgetDataVersion}
        onWidgetError={onWidgetError}
      />;
    }
    const shortcut = shortcuts.get(item.instanceId);
    if (!shortcut) return <div className="grid-error" role="alert">快捷方式数据缺失</div>;
    return <ShortcutIcon
      shortcut={shortcut}
      editMode={editMode}
      locked={item.locked}
      onEdit={onEditShortcut}
      onDuplicate={onDuplicateShortcut}
      onRemove={onRemoveShortcut}
      onToggleLock={() => toggleLock(item)}
    />;
  };

  /**
   * Locks or unlocks one object straight from its badge.
   *
   * Locking is a layout transaction like any other, so it goes through the
   * same preview→commit path the inspector uses: a badge must not write a
   * layout the solver never validated.
   */
  const toggleLock = (item: LayoutItem) => {
    const accepted = onPreviewLayout(columns, {
      type: 'set-lock',
      instanceId: item.instanceId,
      locked: !item.locked,
    });
    if (!accepted) return;
    void onCommitLayout().catch(() => undefined);
  };

  const dragging = drag.instanceId;

  /**
   * The texture is the drop surface, so it is shown exactly when a cell can be
   * targeted: for the whole edit session, and — in normal mode — only while a
   * drag is actually in flight (baseline 7.1: the page stays quiet otherwise).
   */
  const texture = metrics && (editMode || dragging) ? gridCellTexture(metrics) : undefined;

  return (
    <div
      ref={drag.gridRef}
      className={`unified-grid unified-grid--${columns} ${editMode ? 'unified-grid--editing' : ''} ${dragging ? 'unified-grid--dragging' : ''}`}
      data-testid="unified-grid" data-columns={columns}
      style={{ '--grid-columns': columns, ...texture } as React.CSSProperties}
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
            {/*
              Widgets get the "..." badge but not the X: the Workspace schema
              requires every built-in to exist (`validateWorkspace` rejects a
              workspace missing one), so a remove control could only fail.
              Shortcuts carry their own badges inside ShortcutIcon.
            */}
            {editMode && item.kind === 'widget' && <WidgetEditBadge
              label={widgetLabel(item.instanceId)}
              locked={item.locked}
              onToggleLock={() => toggleLock(item)}
              onRemove={() => onRemoveWidget(item.instanceId)}
            />}
          </div>
        );
      })}
      {drag.metrics && drag.origin && drag.intent && <DragOverlay metrics={drag.metrics} origin={drag.origin} intent={drag.intent} />}
    </div>
  );
}
