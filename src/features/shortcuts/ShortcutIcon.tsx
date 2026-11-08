import { useRef } from 'react';
import { Copy, Pencil, X } from 'lucide-react';
import type { Shortcut } from '@/src/domain/workspace/model';
import { fallbackIcon } from '@/src/domain/shortcuts/shortcut';
import { openSafeUrl } from '@/src/domain/search/search';
import { exceedsClickDragThreshold } from '@/src/domain/interaction/pointerIntent';

export function ShortcutIcon({ shortcut, editMode, onEdit, onDuplicate, onRemove }: {
  readonly shortcut: Shortcut;
  readonly editMode: boolean;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly onDuplicate: (shortcut: Shortcut) => void;
  readonly onRemove: (shortcut: Shortcut) => void;
}) {
  const pointerStart = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const dragged = useRef(false);

  return (
    <div className={`shortcut ${editMode ? 'shortcut--editing' : ''}`} data-shortcut-id={shortcut.id}>
      <a
        className="shortcut__hit-area" href={shortcut.url}
        target={shortcut.openTarget === 'new' ? '_blank' : undefined}
        rel="noreferrer" aria-label={`打开 ${shortcut.title}`}
        draggable={false}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          const start = pointerStart.current;
          if (start?.id === event.pointerId && exceedsClickDragThreshold(start, { x: event.clientX, y: event.clientY })) dragged.current = true;
        }}
        onPointerCancel={() => { pointerStart.current = undefined; dragged.current = true; }}
        onClick={(event) => {
          // A movement is not a navigation. Stage 2B can start a drag transaction
          // from the same threshold without stealing a normal click.
          const shouldSuppress = editMode || dragged.current;
          pointerStart.current = undefined;
          dragged.current = false;
          event.preventDefault();
          if (!shouldSuppress) openSafeUrl(shortcut.url, shortcut.openTarget);
        }}
      >
        <span className="shortcut__icon" style={{ background: shortcut.accentColor }}>
          <span className="shortcut__initials">{shortcut.icon || fallbackIcon(shortcut.title)}</span>
        </span>
        <span className="shortcut__label">{shortcut.title}</span>
      </a>
      {editMode && <div className="shortcut__actions">
        <button className="shortcut__delete" onClick={() => onRemove(shortcut)} aria-label={`删除 ${shortcut.title}`} title="删除"><X size={12} /></button>
        <button className="shortcut__edit" onClick={() => onEdit(shortcut)} aria-label={`编辑 ${shortcut.title}`} title="编辑"><Pencil size={12} /></button>
        <button className="shortcut__duplicate" onClick={() => onDuplicate(shortcut)} aria-label={`复制 ${shortcut.title}`} title="复制"><Copy size={12} /></button>
      </div>}
    </div>
  );
}
