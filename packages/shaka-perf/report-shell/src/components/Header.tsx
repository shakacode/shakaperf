/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportMeta } from '../types';
import { pipelineReportLabel, renderPipelineHeaderUrls } from '../../../src/pipeline/pipeline-artifacts';

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Header({ meta, total }: { meta: ReportMeta; total: number }) {
  return (
    <header className="header">
      <div className="header__topline">
        <div className="header__brand">
          <strong>shaka-perf</strong>{pipelineReportLabel(meta)}
        </div>
      </div>

      <h1 className="header__title">{meta.title}</h1>

      <dl className="header__meta">
        <div>
          <dt>tests</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>elapsed</dt>
          <dd>{formatDuration(meta.durationMs)}</dd>
        </div>
        <div>
          <dt>generated</dt>
          <dd>{formatTimestamp(meta.generatedAt)}</dd>
        </div>
        {renderPipelineHeaderUrls(meta)}
      </dl>
    </header>
  );
}
