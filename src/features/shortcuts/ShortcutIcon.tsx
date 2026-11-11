import { useRef, useState } from 'react';
import type { Shortcut } from '@/src/domain/workspace/model';
import { fallbackIcon } from '@/src/domain/shortcuts/shortcut';
import { openSafeUrl } from '@/src/domain/search/search';
import { exceedsClickDragThreshold } from '@/src/domain/interaction/pointerIntent';
import { EditBadges } from '@/src/features/grid/EditBadges';
import { EditMenu } from '@/src/features/grid/EditMenu';

export function ShortcutIcon({ shortcut, editMode, locked = false, onEdit, onDuplicate, onRemove, onToggleLock }: {
  readonly shortcut: Shortcut;
  readonly editMode: boolean;
  readonly locked?: boolean;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly onDuplicate: (shortcut: Shortcut) => void;
  readonly onRemove: (shortcut: Shortcut) => void;
  readonly onToggleLock?: () => void;
}) {
  const pointerStart = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const dragged = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
          // Navigation is always handled below, never by the anchor's default.
          event.preventDefault();
          if (shouldSuppress) return;

          /*
            Modifier clicks are a documented browser convention: ⌘/Ctrl+click
            means "open in a new tab", regardless of how the link is configured.
            Unconditionally honouring `shortcut.openTarget` swallowed that — a
            user expecting a background tab got their current page navigated
            away instead, losing whatever they were doing.
          */
          const forceNewTab = event.metaKey || event.ctrlKey;
          openSafeUrl(shortcut.url, forceNewTab ? 'new' : shortcut.openTarget);
        }}
      >
        <span className="shortcut__icon" style={{ background: shortcut.accentColor }}>
          <span className="shortcut__initials">{shortcut.icon || fallbackIcon(shortcut.title)}</span>
        </span>
        <span className="shortcut__label">{shortcut.title}</span>
      </a>
      {/*
        iOS-style corner badges: X removes, "..." holds the rest. Shortcuts are
        removable, so both appear. Duplicate lives in the menu rather than as a
        third corner button — moving it keeps the feature, the crowding is what
        goes away.
      */}
      {editMode && <EditBadges
        label={shortcut.title}
        removable
        onRemove={() => onRemove(shortcut)}
        onMenu={() => setMenuOpen((open) => !open)}
        menuLabel="更多操作"
      />}
      {editMode && menuOpen && <EditMenu
        label={shortcut.title}
        onClose={() => setMenuOpen(false)}
        actions={[
          { label: '编辑', icon: 'edit', onSelect: () => onEdit(shortcut) },
          { label: '复制', icon: 'duplicate', onSelect: () => onDuplicate(shortcut) },
          ...(onToggleLock ? [{ label: locked ? '解锁位置' : '锁定位置', icon: locked ? 'unlock' as const : 'lock' as const, onSelect: onToggleLock }] : []),
        ]}
      />}
    </div>
  );
}
