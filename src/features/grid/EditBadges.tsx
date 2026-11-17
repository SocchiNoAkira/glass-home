import { useState } from 'react';
import { Ellipsis, X } from 'lucide-react';
import { EditMenu } from './EditMenu';

/**
 * iOS-style edit badges (stage 5 UI pass).
 *
 * The previous card showed three small buttons (delete / edit / duplicate)
 * stacked in a corner. At 1x1 cell size they crowded the icon, and only the
 * delete action was discoverable. iOS home-screen editing uses two symmetric
 * affordances instead: a X to remove, a "..." for everything else. That keeps
 * the visible surface to two targets regardless of how many actions exist
 * behind the menu.
 *
 * `removable` exists because the Workspace schema currently *requires* every
 * built-in widget to be present: `validateWorkspace` rejects a workspace that
 * is missing one. Widgets therefore get only the "..." badge until the schema
 * allows removing them — offering a remove control that can only fail is worse
 * than not offering it.
 */
export interface EditBadgesProps {
  readonly label: string;
  readonly removable: boolean;
  readonly onRemove?: () => void;
  readonly onMenu: () => void;
  /** Menu is conceptually "settings"; exposed as text for the tooltip. */
  readonly menuLabel?: string;
}

export function EditBadges({ label, removable, onRemove, onMenu, menuLabel = '更多操作' }: EditBadgesProps) {
  return <>
    {removable && onRemove && (
      <button
        type="button"
        className="edit-badge edit-badge--remove"
        onClick={(event) => { event.stopPropagation(); onRemove(); }}
        // The visible glyph is a X; the accessible name says what it does.
        aria-label={`移除 ${label}`}
        title="移除"
      ><X size={13} strokeWidth={2.6} /></button>
    )}
    <button
      type="button"
      className="edit-badge edit-badge--menu"
      onClick={(event) => { event.stopPropagation(); onMenu(); }}
      aria-label={`${menuLabel}：${label}`}
      title={menuLabel}
    ><Ellipsis size={14} strokeWidth={2.6} /></button>
  </>;
}

/**
 * Badge pair for a built-in widget: X removes, "..." holds the rest.
 *
 * The X used to be absent because the schema required every built-in widget to
 * exist, so a remove control could only ever surface an error. Widgets became
 * removable (the gallery re-adds them), so the badge now matches shortcuts:
 * one visible target per action, and the destructive one is behind a confirm
 * dialog in `App`.
 */
export function WidgetEditBadge({ label, locked, onToggleLock, onRemove }: {
  readonly label: string;
  readonly locked: boolean;
  readonly onToggleLock: () => void;
  readonly onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button
      type="button"
      className="edit-badge edit-badge--remove"
      onClick={(event) => { event.stopPropagation(); onRemove(); }}
      aria-label={`移除 ${label} 小组件`}
      title="移除小组件"
    ><X size={13} strokeWidth={2.6} /></button>
    <button
      type="button"
      className="edit-badge edit-badge--menu"
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      aria-label={`更多操作：${label}`}
      title="更多操作"
    ><Ellipsis size={14} strokeWidth={2.6} /></button>
    {open && <EditMenu
      label={label}
      onClose={() => setOpen(false)}
      actions={[
        { label: locked ? '解锁位置' : '锁定位置', icon: locked ? 'unlock' : 'lock', onSelect: onToggleLock },
        { label: '移除小组件', icon: 'delete', onSelect: onRemove, dangerous: true },
      ]}
    />}
  </>;
}
