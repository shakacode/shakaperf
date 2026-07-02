/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  DetailedArtifactDialog,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import type {
  AccessibilityScan,
  AccessibilityViolation,
} from './types';
import { AccessibilityDialog, AccessibilityDialogMeta, ThumbnailMarker } from './report-dialog';
import { FilteredEmptyState, useAccessibilityFilterState } from './report-filter';
import { ACCESSIBILITY_CSS, ACCESSIBILITY_PREVIEW_CSS } from './report-styles';
import { ViolationTagChips } from './report-tag-chips';
import {
  boundedThumbnailSize,
  impactColor,
  localizedHotspots,
  scanWithVisibleViolations,
  sortViolations,
  type AccessibilityFilterOptions,
} from './report-utils';

export function ScreenshotPreview({
  filterOptions,
  includeFilterStyles = true,
  rawArtifactHref,
  scan,
  totalViolationCount,
}: {
  filterOptions: AccessibilityFilterOptions;
  includeFilterStyles?: boolean;
  rawArtifactHref?: string;
  scan: AccessibilityScan;
  totalViolationCount: number;
}) {
  const filterState = useAccessibilityFilterState();
  const screenshot = scan.screenshot;
  const source = screenshot?.imageHref ?? screenshot?.imageDataUri;
  if (!screenshot || !source) return null;
  const visibleScan = filterState ? scanWithVisibleViolations(scan, filterState.selection) : scan;
  const hotspots = localizedHotspots(visibleScan);
  const issueCount = visibleScan.violations.length;
  const nodeCount = visibleScan.violations.reduce((total, violation) => total + violation.nodes.length, 0);
  const thumbSize = boundedThumbnailSize(screenshot.width, screenshot.height);

  return (
    <div style={{ marginTop: 10 }}>
      <style>{includeFilterStyles ? ACCESSIBILITY_CSS : ACCESSIBILITY_PREVIEW_CSS}</style>
      <div className="a11y-preview-card">
        <DetailedArtifactDialog
          className="a11y-thumb-button"
          href={source}
          label={`${scan.viewportLabel} accessibility issues`}
          extra={<AccessibilityDialogMeta scan={scan} hotspotCount={hotspots.length} />}
          body={<AccessibilityDialog filterOptions={filterOptions} scan={scan} source={source} />}
        >
          <div className="a11y-thumb">
            <div
              className="a11y-thumb__image"
              style={{ width: thumbSize.width, height: thumbSize.height }}
            >
              <img src={source} alt="" loading="lazy" />
              {hotspots.slice(0, 12).map(({ violation, node }, index) => (
                <ThumbnailMarker
                  key={`${violation.ruleId}-${index}`}
                  node={node}
                  screenshot={screenshot}
                />
              ))}
            </div>
            <div className="a11y-thumb__summary">
              <div className="a11y-thumb__summary-head">
                <span className="a11y-thumb__title">inspect screenshot</span>
                <span className="a11y-thumb__count">
                  {issueCount === totalViolationCount
                    ? `${issueCount} rule violation${issueCount === 1 ? '' : 's'}`
                    : `${issueCount} of ${totalViolationCount} rule violations`}
                  {' · '}
                  {nodeCount} node{nodeCount === 1 ? '' : 's'}
                </span>
              </div>
              {visibleScan.violations.length > 0 ? (
                <IssueSummary
                  configuredTags={filterOptions.tags}
                  violations={visibleScan.violations}
                />
              ) : (
                <FilteredEmptyState totalViolationCount={totalViolationCount} />
              )}
            </div>
          </div>
        </DetailedArtifactDialog>
        <FullReportOnly>
          {rawArtifactHref ? (
            <div className="a11y-preview-card__footer">
              <a className="a11y-raw-link" href={rawArtifactHref} target="_blank" rel="noreferrer">
                raw JSON
              </a>
            </div>
          ) : null}
        </FullReportOnly>
      </div>
    </div>
  );
}

function IssueSummary({
  configuredTags,
  violations,
}: {
  configuredTags: AccessibilityFilterOptions['tags'];
  violations: readonly AccessibilityViolation[];
}) {
  const maxLines = 6;
  const visible = sortViolations(violations).slice(0, maxLines);
  const hidden = violations.length - visible.length;
  return (
    <div className="a11y-thumb__rules">
      {visible.map((violation) => (
        <div className="a11y-thumb__rule" key={violation.ruleId}>
          <span className="a11y-thumb__rule-id">{violation.ruleId}</span>
          <span
            className="a11y-thumb__rule-impact"
            style={{ color: impactColor(violation.impact) }}
          >
            {violation.impact ?? 'unknown'}
          </span>
          <ViolationTagChips configuredTags={configuredTags} violation={violation} />
          <span className="a11y-thumb__rule-count">
            {violation.nodes.length} node{violation.nodes.length === 1 ? '' : 's'}
          </span>
          <span className="a11y-thumb__rule-help">
            {violation.help}
          </span>
        </div>
      ))}
      {hidden > 0 ? (
        <div className="a11y-thumb__more">+{hidden} more</div>
      ) : null}
    </div>
  );
}
