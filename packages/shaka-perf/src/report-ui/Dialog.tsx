/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ImageSizeContext } from '../pipeline/image-viewport';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'compact' | 'wide';
  image?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  meta,
  children,
  variant = 'default',
  image = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [imageSize, setImageSize] = useState<'fit' | 'actual'>('fit');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
    return () => {
      if (el.open) el.close();
    };
  }, [open]);

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
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === el) onClose();
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`ui-dialog${image ? ' ui-dialog--image' : ''}${variant === 'default' ? '' : ` ui-dialog--${variant}`}`}
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="ui-dialog__surface">
        <header className="ui-dialog__head">
          <div id={title ? titleId : undefined} className="ui-dialog__title">{title}</div>
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
        {image ? (
          <div className="image-size" role="group" aria-label="Image size">
            <button type="button" aria-pressed={imageSize === 'fit'} onClick={() => setImageSize('fit')}>Fit to window</button>
            <button type="button" aria-pressed={imageSize === 'actual'} onClick={() => setImageSize('actual')}>Actual size</button>
          </div>
        ) : null}
        <div className="ui-dialog__body">
          <ImageSizeContext.Provider value={imageSize}>{children}</ImageSizeContext.Provider>
        </div>
      </div>
    </dialog>
  );
}
