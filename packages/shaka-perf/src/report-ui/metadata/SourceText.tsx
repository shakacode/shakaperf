/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useState } from 'react';
import { CopyableText } from '../controls/CopyableText';

type SourceLoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed' };

// Callers key this component by href so a new snapshot starts with fresh state.
export function SourceText({ href }: { href: string | null }) {
  const [source, setSource] = useState<SourceLoadState>({ status: 'loading' });

  useEffect(() => {
    if (!href) return;
    const controller = new AbortController();

    async function loadSource(sourceHref: string) {
      try {
        const response = await fetch(sourceHref, { signal: controller.signal });
        if (!response.ok) throw new Error('Source unavailable');
        const text = await response.text();
        if (!controller.signal.aborted) setSource({ status: 'ready', text });
      } catch {
        if (!controller.signal.aborted) setSource({ status: 'failed' });
      }
    }

    void loadSource(href);
    return () => controller.abort();
  }, [href]);

  if (!href) return <p>No source snapshot was captured.</p>;
  if (source.status === 'loading') return <p>Loading source…</p>;
  if (source.status === 'failed') return <p>Source snapshot unavailable.</p>;
  return <CopyableText text={source.text} label="Source snapshot" copyLabel="Copy test source" />;
}
