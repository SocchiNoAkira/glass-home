import type { LayoutItem, GridColumns } from '@/src/domain/grid/model';
import { readingOrder } from '@/src/domain/grid/model';
import type { Shortcut, Workspace } from '@/src/domain/workspace/model';
import { ClockWidget } from '@/src/features/clock/ClockWidget';
import { CalendarWidget } from '@/src/features/calendar/CalendarWidget';
import { SearchWidget } from '@/src/features/search/SearchWidget';
import { ShortcutIcon } from '@/src/features/shortcuts/ShortcutIcon';

export function HomeGrid({ workspace, columns, editMode, onChooseSearchEngine, onEditShortcut, onDuplicateShortcut, onRemoveShortcut }: {
  readonly workspace: Workspace;
  readonly columns: GridColumns;
  readonly editMode: boolean;
  readonly onChooseSearchEngine: () => void;
  readonly onEditShortcut: (shortcut: Shortcut) => void;
  readonly onDuplicateShortcut: (shortcut: Shortcut) => void;
  readonly onRemoveShortcut: (shortcut: Shortcut) => void;
}) {
  const shortcuts = new Map(workspace.shortcuts.map((shortcut) => [shortcut.id, shortcut]));
  const items = readingOrder(workspace.layouts[columns]);

  const renderItem = (item: LayoutItem) => {
    if (item.instanceId === 'builtin.clock') return <ClockWidget settings={workspace.settings} />;
    if (item.instanceId === 'builtin.search') return <SearchWidget settings={workspace.settings} onChooseEngine={onChooseSearchEngine} />;
    if (item.instanceId === 'builtin.calendar') return <CalendarWidget settings={workspace.settings} />;
    const shortcut = shortcuts.get(item.instanceId);
    if (!shortcut) return <div className="grid-error" role="alert">快捷方式数据缺失</div>;
    return <ShortcutIcon shortcut={shortcut} editMode={editMode} onEdit={onEditShortcut} onDuplicate={onDuplicateShortcut} onRemove={onRemoveShortcut} />;
  };

  return (
    <div
      className={`unified-grid unified-grid--${columns} ${editMode ? 'unified-grid--editing' : ''}`}
      data-testid="unified-grid" data-columns={columns}
      style={{ '--grid-columns': columns } as React.CSSProperties}
      aria-label={`主屏幕统一网格，${columns} 列`}
    >
      {items.map((item) => (
        <div
          key={item.instanceId}
          className={`grid-item grid-item--${item.instanceId.replaceAll('.', '-')} ${item.kind === 'widget' ? 'grid-item--widget' : 'grid-item--shortcut'}`}
          style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}
          data-instance-id={item.instanceId}
          data-grid-x={item.x} data-grid-y={item.y} data-grid-w={item.w} data-grid-h={item.h}
        >
          {renderItem(item)}
          {editMode && item.kind === 'widget' && <span className="grid-item__edit-badge" title="拖动与尺寸调整将在阶段 2 开放">组件</span>}
        </div>
      ))}
    </div>
  );
}
