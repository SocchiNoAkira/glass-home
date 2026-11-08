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

  return (
    <dialog
      ref={dialogRef} className={`modal glass-panel ${className}`} aria-label={title}
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
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
