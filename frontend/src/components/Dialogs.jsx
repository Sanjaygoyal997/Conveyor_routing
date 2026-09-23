import React, { useEffect, useRef } from "react";

// Modal shell on the native <dialog> element (opened on mount, Esc / ✕ call onClose).
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.open && d.close();
  }, []);
  return (
    <dialog ref={ref} className="fix-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="dlg-head">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="dlg-body">{children}</div>
    </dialog>
  );
}

export function ConfirmDialog({ title, detail, onAnswer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.open && d.close();
  }, []);
  return (
    <dialog ref={ref} className="confirm-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onAnswer(false); }}>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="dlg-actions">
        <button onClick={() => onAnswer(false)}>Cancel</button>
        <button className="primary" autoFocus onClick={() => onAnswer(true)}>Confirm</button>
      </div>
    </dialog>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.bad ? "bad" : "good"}`} role="status">{toast.msg}</div>;
}
