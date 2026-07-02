/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { StageRenderEntry } from '../../../stage/stage';
import {
  StageArtifact,
  StageArtifactTitle,
} from '../../../pipeline/stage-report-components';
import type { AgentReadinessResult } from './types';

// Technical (self-contained dev report) view of the agent-readiness measurement.
// Deliberately compact: the client-facing presentation is the "Agent Ready" tab
// of the client report; here we just surface the raw numbers for an engineer.
export function AgentReadinessArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AgentReadinessResult>[];
}) {
  if (measurements.length === 0) return null;
  return (
    <StageArtifact>
      <StageArtifactTitle>agent readiness</StageArtifactTitle>
      <div className="stage-stack">
        {measurements.map((entry, index) => {
          const m = entry.measurement;
          const raw = m.raw.signals;
          const r = m.rendered;
          const rawWords = raw?.textWords ?? 0;
          const coverage = r.textWords > 0 ? Math.round((rawWords / r.textWords) * 100) : 0;
          return (
            <div key={`${entry.viewport.label}-${index}`} className="stage-stack__viewport">
              <div className="stage-section__head">{entry.viewport.label}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                <li>
                  Raw fetch: {m.raw.ok ? 'ok' : 'failed'}
                  {m.raw.status ? ` (HTTP ${m.raw.status})` : ''}
                  {m.raw.likelyBlocked ? ', looks bot-blocked' : ''}
                </li>
                <li>
                  Text words: raw {rawWords} vs rendered {r.textWords} ({coverage}% reachable without JS)
                </li>
                <li>Structured data: {r.structuredData.types.join(', ') || 'none'}</li>
                <li>
                  Title {r.titlePresent ? 'yes' : 'no'}, meta description{' '}
                  {r.metaDescriptionPresent ? 'yes' : 'no'}, h1 x{r.headings.h1Count}
                </li>
                <li>
                  Landmarks: {Object.entries(r.landmarks).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
                </li>
                <li>
                  Images with alt: {r.images.withAlt}/{r.images.total}, descriptive links:{' '}
                  {r.links.total - r.links.nondescriptive}/{r.links.total}
                </li>
              </ul>
            </div>
          );
        })}
      </div>
    </StageArtifact>
  );
}
