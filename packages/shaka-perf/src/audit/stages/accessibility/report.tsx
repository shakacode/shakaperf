/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useMemo } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  StageArtifact,
  StageArtifactTitle,
} from '../../../pipeline/stage-report-components';
import type { AccessibilityResult } from './types';
import { ScreenshotPreview } from './report-preview';
import { SCAN_STYLE } from './report-styles';
import { useAccessibilityFilterState } from './report-filter';
import { collectConfiguredFilterOptions } from './report-utils';

export {
  AccessibilityGlobalFilter,
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
      <StageArtifactTitle>accessibility</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((entry, index) => (
          <div key={`${entry.viewport.label}-${index}`} className="stage-stack__viewport">
            <AccessibilityBody
              result={entry.measurement}
              viewportLabel={entry.viewport.label}
            />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function AccessibilityBody({
  result,
  viewportLabel,
}: {
  result: AccessibilityResult;
  viewportLabel: string;
}) {
  const filterState = useAccessibilityFilterState();
  const localOptions = useMemo(() => collectConfiguredFilterOptions([result]), [result]);
  const scan = result.scans[0];
  if (!scan) return null;
  const totalCount = scan.violations.length;
  if (totalCount === 0) return null;
  return (
    <div className="stage-section">
      <div className="stage-section__head">{viewportLabel}</div>
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
