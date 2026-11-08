import { useRef, useState } from 'react';

export function RecoveryActions({ onExport, onImport, onReset }: {
  readonly onExport: () => Promise<void>;
  readonly onImport: (file: File) => Promise<void>;
  readonly onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="data-actions">
      <button className="button button--secondary" disabled={busy} onClick={() => void run(onExport)}>导出原始数据</button>
      <button className="button button--secondary" disabled={busy} onClick={() => inputRef.current?.click()}>导入备份</button>
      <button className="button button--primary" disabled={busy} onClick={onReset}>重建默认主屏幕</button>
      <input
        ref={inputRef} className="sr-only" type="file" accept="application/json,.json"
        aria-label="选择恢复备份"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void run(() => onImport(file));
          event.target.value = '';
        }}
      />
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
