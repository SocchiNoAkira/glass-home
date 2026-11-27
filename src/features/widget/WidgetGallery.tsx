import { BellPlus, CalendarDays, Clock, ListTodo, Plus, Search } from 'lucide-react';
import { Modal } from '@/src/components/Modal';
import { WIDGET_CATALOG, type BuiltinWidgetId } from '@/src/domain/widget/catalog';

const ICONS: Record<BuiltinWidgetId, typeof Clock> = {
  'builtin.clock': Clock,
  'builtin.search': Search,
  'builtin.calendar': CalendarDays,
  'builtin.todo': ListTodo,
  'builtin.reminder': BellPlus,
};

/**
 * iOS-style widget gallery.
 *
 * iOS puts a "+" on the home screen in edit mode and offers a sheet of widget
 * types; a type that is already placed is shown as such instead of being
 * addable again. This build has one instance per type — the to-do widget's data
 * lives under a namespace named after the type, so a second copy would silently
 * share the first one's list — hence "已在主屏幕" rather than a second entry.
 */
export function WidgetGallery({ present, busy, onAdd, onClose }: {
  readonly present: readonly string[];
  readonly busy: boolean;
  readonly onAdd: (widgetId: BuiltinWidgetId) => void;
  readonly onClose: () => void;
}) {
  return <Modal title="小组件" eyebrow="ADD A WIDGET" onClose={onClose} className="widget-gallery">
    <p className="settings-note">选一个放到主屏幕。每个小组件会落在三个断点各自的第一个空位，尺寸与默认布局一致。</p>
    <div className="widget-gallery__list">
      {WIDGET_CATALOG.map((entry) => {
        const added = present.includes(entry.widgetId);
        const Icon = ICONS[entry.widgetId];
        return <div key={entry.widgetId} className={`widget-card ${added ? 'is-added' : ''}`}>
          <span className="widget-card__icon" aria-hidden="true"><Icon size={19} /></span>
          <span className="widget-card__text">
            <strong>{entry.label}</strong>
            <small>{entry.description}</small>
          </span>
          {added
            ? <span className="widget-card__state">已在主屏幕</span>
            : <button
              type="button"
              className="button button--primary button--small"
              disabled={busy}
              onClick={() => onAdd(entry.widgetId)}
              aria-label={`添加${entry.label}小组件`}
            ><Plus size={14} />添加</button>}
        </div>;
      })}
    </div>
  </Modal>;
}
