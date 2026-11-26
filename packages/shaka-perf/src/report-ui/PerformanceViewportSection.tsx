/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useState, type ReactNode } from 'react';
import type { ExecutionDetails } from '../pipeline/outcome';
import { ReportSection } from './ReportSection';
import { OldRunChip } from './OldRunChip';
import { MetadataRows } from './ArtifactMetadataFields';

export function PerformanceViewportSection({ sectionKey, executionDetails, latestRun, children }: {
  sectionKey: string;
  executionDetails: ExecutionDetails;
  latestRun: boolean;
  children: ReactNode;
}) {
  const { viewport, stageMetadata } = executionDetails;
  const hasSettings = stageMetadata && Object.keys(stageMetadata).length > 0;
  const [showSettings, setShowSettings] = useState(false);
  const settingsId = useId();
  return (
    <section
      className="stage-stack__viewport perf-viewport"
      aria-label={`${viewport.label} performance`}
    >
      <ReportSection
        sectionKey={sectionKey}
        title={`${viewport.label} performance`}
        badge={<OldRunChip latestRun={latestRun} />}
        actions={hasSettings && (
          <>
            {showSettings ? (
              <span className="perf-viewport__dimensions">
                {viewport.width} × {viewport.height}
              </span>
            ) : null}
            <button
              type="button"
              className="perf-run-settings-toggle"
              aria-expanded={showSettings}
              aria-controls={settingsId}
              onClick={() => setShowSettings(previous => !previous)}
            >
              {showSettings ? 'hide metadata' : 'show metadata'}
            </button>
          </>
        )}
        nested
      >
        {hasSettings ? (
          <div id={settingsId} className="perf-run-settings" hidden={!showSettings}>
            <MetadataRows fields={stageMetadata} />
          </div>
        ) : null}

        {children}
      </ReportSection>
    </section>
  );
}
