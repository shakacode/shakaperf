/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function TooltipLabel({ label, explanation }: { label: string; explanation: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const id = useId();

  const placeTooltip = useCallback(() => {
    if (!button.current || !tooltip.current) return;
    const anchor = button.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)),
      top: anchor.bottom + 8 + box.height <= window.innerHeight - 12
        ? anchor.bottom + 8
        : Math.max(12, anchor.top - box.height - 8),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) placeTooltip();
  }, [open, explanation, placeTooltip]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onOutside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('scroll', placeTooltip, true);
    window.addEventListener('resize', placeTooltip);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener('scroll', placeTooltip, true);
      window.removeEventListener('resize', placeTooltip);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [open, placeTooltip]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="report-tooltip__trigger"
        aria-label={`${label}: explanation`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (document.activeElement !== button.current) setOpen(false); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (open && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {label} <span className="report-tooltip__help" aria-hidden="true">?</span>
      </button>
      {open ? createPortal(
        <div ref={tooltip} id={id} role="tooltip" className="report-tooltip" style={position}>
          {explanation}
        </div>,
        button.current?.closest('dialog') ?? document.body,
      ) : null}
    </>
  );
}
