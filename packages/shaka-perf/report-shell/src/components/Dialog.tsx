import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Metadata block rendered below the title bar, above the body. */
  meta?: ReactNode;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, meta, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Lock the outer page scroll while the dialog is open. Native <dialog>
  // in modal state focus-traps and blocks tab navigation, but the browser
  // still routes wheel/touch scroll to the underlying page when the cursor
  // is over the backdrop — which is visually jarring.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    // Click on backdrop: a direct click on the <dialog> element itself (not
    // its surface child) means the user hit the backdrop area.
    const onClick = (e: MouseEvent) => {
      if (e.target === el) onClose();
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} className="ui-dialog">
      <div className="ui-dialog__surface">
        <header className="ui-dialog__head">
          <div className="ui-dialog__title">{title}</div>
          <button
            type="button"
            className="ui-dialog__close"
            aria-label="close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {meta ? <div className="ui-dialog__meta-wrap">{meta}</div> : null}
        <div className="ui-dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
