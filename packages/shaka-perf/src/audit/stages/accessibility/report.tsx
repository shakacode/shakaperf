/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useMemo } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  ArtifactScope,
  StageArtifact,
  StageArtifactTitle,
  ReportHeading,
  OldRunChip,
} from '../../../pipeline/stage-report-components';
import type { AccessibilityResult } from './types';
import { ScreenshotPreview } from './report-preview';
import { SCAN_STYLE } from './report-styles';
import { useAccessibilityFilterState } from './report-filter';
import { collectConfiguredFilterOptions } from './report-utils';

export {
  AccessibilityReportFilterProvider,
  type AccessibilityFilterState,
} from './report-filter';
export {
  collectConfiguredFilterOptions,
  countFilterOptionsForScans,
  defaultAccessibilityFilterSelection,
  hasAccessibilityFilterOptions,
  isViolationVisibleForFilters,
  isViolationVisibleForTags,
  normalizeAccessibilityFilterSelection,
  type AccessibilityFilterOptions,
  type AccessibilityFilterSelection,
  type FilterOption,
} from './report-utils';

export function AccessibilityArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AccessibilityResult>[];
}) {
  const rows = measurements.filter((entry) =>
    entry.measurement.scans.some((scan) => scan.violations.length > 0),
  );
  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle title="accessibility" />
      <div className="stage-stack">
        {rows.map((entry, index) => (
          <ArtifactScope key={`${entry.viewport.label}-${index}`} outcome={entry.outcome}>
            <div className="stage-stack__viewport">
              <AccessibilityBody
                result={entry.measurement}
                viewportLabel={entry.viewport.label}
                latestRun={entry.latestRun}
              />
            </div>
          </ArtifactScope>
        ))}
      </div>
    </StageArtifact>
  );
}

function AccessibilityBody({
  result,
  viewportLabel,
  latestRun,
}: {
  result: AccessibilityResult;
  viewportLabel: string;
  latestRun: boolean;
}) {
  const filterState = useAccessibilityFilterState();
  const localOptions = useMemo(() => collectConfiguredFilterOptions([result]), [result]);
  const scan = result.scans[0];
  if (!scan) return null;
  const totalCount = scan.violations.length;
  if (totalCount === 0) return null;
  return (
    <div className="stage-section">
      <ReportHeading className="stage-section__head" level={5} title={viewportLabel} badge={<OldRunChip latestRun={latestRun} />} />
      <div style={SCAN_STYLE}>
        <ScreenshotPreview
          filterOptions={filterState?.options ?? localOptions}
          includeFilterStyles={!filterState}
          rawArtifactHref={result.rawArtifactHref}
          scan={scan}
          totalViolationCount={scan.violations.length}
        />
      </div>
    </div>
  );
}
