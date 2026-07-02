/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import { StageArtifact, StageArtifactTitle } from '../../../pipeline/stage-report-components';
import type { AiSummaryResult } from './stage';

const SUMMARY_BOX_STYLE: CSSProperties = {
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 15,
  lineHeight: 1.45,
  color: 'var(--fg, #1f2937)',
  background: 'var(--bg-elevated, #f5f6f8)',
  border: '1px solid var(--border, #d1d5db)',
  borderLeft: '4px solid var(--accent, #2563eb)',
  borderRadius: 4,
  padding: '12px 14px',
};

export function AiSummaryArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AiSummaryResult>[];
}) {
  // All viewports audit the same page, so a single plain-language line is
  // enough — show the first non-empty summary. Nothing to render if the AI
  // call produced no summary.
  const summary = measurements
    .map((entry) => entry.measurement.summary)
    .find((text) => text != null && text.trim().length > 0);
  if (!summary) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle>summary</StageArtifactTitle>
      <div style={SUMMARY_BOX_STYLE}>{summary}</div>
    </StageArtifact>
  );
}
