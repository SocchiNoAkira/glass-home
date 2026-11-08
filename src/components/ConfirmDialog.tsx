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
    <div className="modal__actions"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button type="button" className={`button ${dangerous ? 'button--danger' : 'button--primary'}`} onClick={onConfirm} autoFocus>{confirmLabel}</button></div>
  </Modal>;
}
