import { useEffect, useRef } from 'react';
import { Copy, Pencil, Lock, LockOpen, Trash2 } from 'lucide-react';

/**
 * Action popover opened by the "..." badge in edit mode.
 *
 * iOS puts the destructive action on a X badge and the rest behind "...". Here
 * the menu holds everything that is not "remove": edit, duplicate and lock.
 * Duplicating used to be a third tiny corner button, which is exactly the
 * crowding this menu is meant to remove — dropping it silently would be worse
 * than moving it.
 *
 * Positioning is handled by the caller's wrapper, so this stays layout-agnostic.
 */
export interface EditMenuAction {
  readonly label: string;
  readonly icon: 'edit' | 'duplicate' | 'lock' | 'unlock' | 'delete';
  readonly onSelect: () => void;
  readonly dangerous?: boolean;
}

const ICONS = {
  edit: Pencil,
  duplicate: Copy,
  lock: Lock,
  unlock: LockOpen,
  delete: Trash2,
} as const;

export function EditMenu({ label, actions, onClose }: {
  /** Whose menu this is; used in the dialog label for screen readers. */
  readonly label: string;
  readonly actions: readonly EditMenuAction[];
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click and on Escape. A menu that can only be closed by
  // clicking a specific spot is a trap when it overlaps the grid.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop the grid's Esc handler from also cancelling a preview behind this.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return <div ref={ref} className="edit-menu glass-surface" role="group" aria-label={`${label} 的操作`}>
    {actions.map((action) => {
      const Icon = ICONS[action.icon];
      return <button
        key={action.label}
        type="button"
        // Plain buttons, not `menuitem`: this popover is a list of action buttons
        // rather than an ARIA menu, so it keeps the ordinary button role (and
        // its familiar keyboard and screen-reader behaviour) instead of claiming
        // a menu pattern it does not implement.
        className={`edit-menu__item ${action.dangerous ? 'is-dangerous' : ''}`}
        onClick={() => { action.onSelect(); onClose(); }}
      ><Icon size={13} />{action.label}</button>;
    })}
  </div>;
}
