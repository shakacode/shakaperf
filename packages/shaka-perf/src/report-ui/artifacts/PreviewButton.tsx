/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState, type ReactNode } from 'react';

export function PreviewButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        marginTop: 12,
        padding: 0,
        border: `1px solid ${hovered ? 'var(--fg-muted)' : 'var(--border-strong)'}`,
        background: 'var(--bg-elevated)',
        // `color: inherit` here defeats the global `button:hover { color: #fff }`
        // (which would otherwise turn the inline "Lighthouse report" / profile-frames
        // label invisible on hover).
        color: 'inherit',
        cursor: 'zoom-in',
        appearance: 'none',
        // The global `button { text-transform: lowercase }` mangles labels
        // we render *inside* the button (e.g. "Lighthouse report" → "lighthouse
        // report"); reset to none here so proper-noun casing survives.
        textTransform: 'none',
        letterSpacing: 'normal',
      }}
    >
      {children}
    </button>
  );
}
