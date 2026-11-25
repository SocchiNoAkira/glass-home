import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, eyebrow, children, onClose, className = '' }: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly children: React.ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  /*
    Escape closes the dialog through this listener, not through the native
    `cancel` event.
    
    Chromium fires `cancel` on the dialog both for Escape *and* when a file
    picker opened from inside the dialog is dismissed. Treating every `cancel` as
    "close" therefore closed the whole settings panel — and discarded unsaved
    edits — the moment someone canceled the import picker. `cancel` is now only
    prevented (so the browser cannot close the element behind React's back), and
    a real Escape keypress does the closing.

    Only the topmost dialog reacts: confirm dialogs are opened above the settings
    panel, and Escape must close one layer at a time.
  */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = [...document.querySelectorAll('dialog[open]')];
      if (open.at(-1) !== dialogRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <dialog
      ref={dialogRef} className={`modal glass-panel ${className}`} aria-label={title} data-adaptive-ink=""
      onCancel={(event) => { event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
    >
      <div className="modal__inner">
        <header className="modal__header">
          <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`关闭${title}`}><X size={20} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
