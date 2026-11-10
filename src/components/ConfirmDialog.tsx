import { Modal } from './Modal';

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, dangerous = false }: {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly dangerous?: boolean;
}) {
  return <Modal title={title} onClose={onClose} className="confirm-dialog">
    <p className="modal__description">{description}</p>
    {/*
      Focus lands on the safe option for a destructive dialog.
      `autoFocus` on the confirm button meant the dialog opened with focus on
      "delete everything" — a stray Enter destroyed the user's data. For a
      dangerous action the default must be 取消; the confirm button still
      auto-focuses for a benign action, which keeps the Enter-to-confirm
      convenience where it costs nothing.
    */}
    <div className="modal__actions">
      <button type="button" className="button button--secondary" onClick={onClose} autoFocus={dangerous}>取消</button>
      <button type="button" className={`button ${dangerous ? 'button--danger' : 'button--primary'}`} onClick={onConfirm} autoFocus={!dangerous}>{confirmLabel}</button>
    </div>
  </Modal>;
}
