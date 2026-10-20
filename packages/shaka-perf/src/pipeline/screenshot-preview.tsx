/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState } from 'react';

/** Keep the whole screenshot visible without letting long pages stretch a card. */
export function ScreenshotPreview({ src, alt }: { src: string; alt: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: 220,
        background: 'var(--bg-sunken)',
      }}
    >
      {failedSource === src ? (
        <span role="img" aria-label={`${alt}: screenshot unavailable`}>
          Screenshot unavailable
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setFailedSource(src)}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </span>
  );
}
