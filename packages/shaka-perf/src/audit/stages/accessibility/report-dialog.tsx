/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  AccessibilityNodeTarget,
  AccessibilityScan,
  AccessibilityViolation,
  AccessibilityViolationNode,
} from './types';
import { AccessibilityFilter, FilteredEmptyState, useAccessibilityFilterState } from './report-filter';
import { NODE_PRE_STYLE } from './report-styles';
import { ViolationTagChips } from './report-tag-chips';
import {
  countFilterOptionsForScans,
  defaultAccessibilityFilterSelection,
  hasAccessibilityFilterOptions,
  hotspotZIndex,
  impactColor,
  isViolationVisibleForFilters,
  localizedHotspots,
  makeIssueId,
  pct,
  sortViolations,
  tooltipPlacement,
  type AccessibilityFilterOptions,
  type AccessibilityFilterSelection,
} from './report-utils';

export function AccessibilityDialogMeta({
  hotspotCount,
  scan,
}: {
  hotspotCount: number;
  scan: AccessibilityScan;
}) {
  const nodeCount = scan.violations.reduce((total, violation) => total + violation.nodes.length, 0);
  return (
    <>
      <div>
        <dt>viewport</dt>
        <dd>{scan.viewportLabel}</dd>
      </div>
      <div>
        <dt>issues</dt>
        <dd>{scan.violations.length} rules · {nodeCount} nodes</dd>
      </div>
      <div>
        <dt>hotspots</dt>
        <dd>{hotspotCount}</dd>
      </div>
      <div>
        <dt>url</dt>
        <dd className="ui-dialog__meta-break">{scan.url}</dd>
      </div>
    </>
  );
}

export function AccessibilityDialog({
  filterOptions,
  scan,
  source,
}: {
  filterOptions: AccessibilityFilterOptions;
  scan: AccessibilityScan;
  source: string;
}) {
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const globalFilter = useAccessibilityFilterState();
  const configuredFilterOptions = globalFilter?.options ?? filterOptions;
  const activeFilterOptions = useMemo(
    () => countFilterOptionsForScans(configuredFilterOptions, [scan]),
    [configuredFilterOptions, scan],
  );
  const filtersAvailable = hasAccessibilityFilterOptions(activeFilterOptions);
  const [localSelected, setLocalSelected] = useState<AccessibilityFilterSelection | null>(null);
  const filterSelection = useMemo(
    () => resolveDialogFilterSelection({
      globalSelection: globalFilter?.selection ?? null,
      localSelection: localSelected,
      options: configuredFilterOptions,
    }),
    [configuredFilterOptions, globalFilter, localSelected],
  );
  const visibleViolations = useMemo(
    () => sortViolations(scan.violations)
      .filter((violation) => !filtersAvailable || isViolationVisibleForFilters(violation, filterSelection)),
    [filterSelection, filtersAvailable, scan.violations],
  );
  const visibleScan = useMemo(
    () => ({ ...scan, violations: visibleViolations }),
    [scan, visibleViolations],
  );
  const hotspots = useMemo(() => localizedHotspots(visibleScan), [visibleScan]);
  const hotspotRefs = useRef(new Map<string, HTMLElement>());
  const issueRefs = useRef(new Map<string, HTMLElement>());
  const localizedIssueIds = useMemo(
    () => new Set<string>(hotspots.map((hotspot) => hotspot.issueId)),
    [hotspots],
  );
  const registerHotspot = useCallback((issueId: string, element: HTMLElement | null) => {
    if (element) hotspotRefs.current.set(issueId, element);
    else hotspotRefs.current.delete(issueId);
  }, []);
  const registerIssue = useCallback((issueId: string, element: HTMLElement | null) => {
    if (element) issueRefs.current.set(issueId, element);
    else issueRefs.current.delete(issueId);
  }, []);
  const clearActiveIssue = useCallback(() => setActiveIssueId(null), []);
  const selectIssue = useCallback((issueId: string, sourceSide: 'hotspot' | 'issue') => {
    setActiveIssueId(issueId);
    const hotspot = hotspotRefs.current.get(issueId);
    const issue = issueRefs.current.get(issueId);
    const details = issue?.closest('details');
    if (details instanceof HTMLDetailsElement) details.open = true;

    window.requestAnimationFrame(() => {
      flashElement(hotspot);
      flashElement(issue);
      if (sourceSide === 'issue') hotspot?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
      else issue?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });
  }, []);

  return (
    <div className="a11y-dialog">
      <div className="a11y-dialog__shot">
        <div className="a11y-shot">
          <img
            src={source}
            width={scan.screenshot?.width}
            height={scan.screenshot?.height}
            alt={`${scan.viewportLabel} accessibility screenshot`}
          />
          {scan.screenshot ? hotspots.map(({ issueId, violation, node }, index) => (
            <Hotspot
              key={`${violation.ruleId}-${index}`}
              active={activeIssueId === issueId}
              configuredTags={activeFilterOptions.tags}
              index={index + 1}
              issueId={issueId}
              violation={violation}
              node={node}
              onSelect={selectIssue}
              register={registerHotspot}
              screenshot={scan.screenshot!}
            />
          )) : null}
        </div>
      </div>
      <div className="a11y-dialog__issues">
        <div className="a11y-dialog__summary">
          <strong>{scan.viewportLabel}</strong>
          <span style={{ color: '#b91c1c', fontWeight: 700 }}>
            {visibleViolations.length === scan.violations.length
              ? `${visibleViolations.length} violation${visibleViolations.length === 1 ? '' : 's'}`
              : `${visibleViolations.length} of ${scan.violations.length} violations`}
          </span>
        </div>
        {filtersAvailable ? (
          <div className="a11y-dialog__filter">
            <AccessibilityFilter
              extraActions={globalFilter ? (
                <button
                  type="button"
                  onClick={() => globalFilter.setSelection(filterSelection)}
                >
                  apply globally
                </button>
              ) : null}
              options={activeFilterOptions}
              selection={filterSelection}
              setSelection={setLocalSelected}
              title="test filters"
              variant="panel"
            />
          </div>
        ) : null}
        {visibleViolations.length > 0 ? (
          visibleViolations.map((violation) => (
            <ViolationDetails
              key={violation.ruleId}
              activeIssueId={activeIssueId}
              clearActiveIssue={clearActiveIssue}
              configuredTags={activeFilterOptions.tags}
              localizedIssueIds={localizedIssueIds}
              onSelect={selectIssue}
              register={registerIssue}
              violation={violation}
            />
          ))
        ) : (
          <FilteredEmptyState totalViolationCount={scan.violations.length} />
        )}
      </div>
    </div>
  );
}

export function resolveDialogFilterSelection({
  globalSelection,
  localSelection,
  options,
}: {
  globalSelection: AccessibilityFilterSelection | null;
  localSelection: AccessibilityFilterSelection | null;
  options: AccessibilityFilterOptions;
}): AccessibilityFilterSelection {
  return localSelection ?? globalSelection ?? defaultAccessibilityFilterSelection(options);
}

export function ThumbnailMarker({
  node,
  screenshot,
}: {
  node: AccessibilityViolationNode;
  screenshot: NonNullable<AccessibilityScan['screenshot']>;
}) {
  const bounds = node.bounds!;
  const style: CSSProperties = {
    left: pct(bounds.x, screenshot.width),
    top: pct(bounds.y, screenshot.height),
    width: pct(bounds.width, screenshot.width),
    height: pct(bounds.height, screenshot.height),
  };
  return <span className="a11y-thumb__marker" style={style} />;
}

function Hotspot({
  active,
  configuredTags,
  index,
  issueId,
  violation,
  node,
  onSelect,
  register,
  screenshot,
}: {
  active: boolean;
  configuredTags: AccessibilityFilterOptions['tags'];
  index: number;
  issueId: string;
  violation: AccessibilityViolation;
  node: AccessibilityViolationNode;
  onSelect: (issueId: string, sourceSide: 'hotspot' | 'issue') => void;
  register: (issueId: string, element: HTMLElement | null) => void;
  screenshot: NonNullable<AccessibilityScan['screenshot']>;
}) {
  const bounds = node.bounds!;
  const placement = tooltipPlacement(bounds, screenshot);
  const style: CSSProperties = {
    left: pct(bounds.x, screenshot.width),
    top: pct(bounds.y, screenshot.height),
    width: pct(bounds.width, screenshot.width),
    height: pct(bounds.height, screenshot.height),
    zIndex: hotspotZIndex(bounds.width, bounds.height, screenshot.width, screenshot.height),
  };
  return (
    <div
      className="a11y-hotspot"
      data-active={active ? 'true' : 'false'}
      data-impact={violation.impact ?? 'unknown'}
      data-issue-id={issueId}
      data-popover-x={placement.x}
      data-popover-y={placement.y}
      onClick={() => onSelect(issueId, 'hotspot')}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(issueId, 'hotspot');
      }}
      ref={(element) => register(issueId, element)}
      role="button"
      style={style}
      tabIndex={0}
      aria-label={`${violation.ruleId}: ${violation.help}`}
    >
      <span className="a11y-hotspot__num">{index}</span>
      <div className="a11y-tooltip">
        <div className="a11y-tooltip__title">
          <strong>{violation.ruleId}</strong>
          <Impact impact={violation.impact} />
          <ViolationTagChips configuredTags={configuredTags} max={2} violation={violation} />
        </div>
        <div className="a11y-tooltip__help">{violation.help}</div>
        <TargetBreadcrumb target={node.target} />
        {node.html ? <pre>{node.html}</pre> : null}
        {node.failureSummary ? <pre>{node.failureSummary}</pre> : null}
      </div>
    </div>
  );
}

function ViolationDetails({
  activeIssueId,
  clearActiveIssue,
  configuredTags,
  localizedIssueIds,
  onSelect,
  register,
  violation,
}: {
  activeIssueId: string | null;
  clearActiveIssue: () => void;
  configuredTags: AccessibilityFilterOptions['tags'];
  localizedIssueIds: ReadonlySet<string>;
  onSelect: (issueId: string, sourceSide: 'hotspot' | 'issue') => void;
  register: (issueId: string, element: HTMLElement | null) => void;
  violation: AccessibilityViolation;
}) {
  const issueIds = violation.nodes.map((_, index) => makeIssueId(violation.ruleId, index));
  const active = issueIds.includes(activeIssueId ?? '');
  const primaryIssueId = issueIds.find((issueId) => localizedIssueIds.has(issueId)) ?? issueIds[0];
  return (
    <details className="a11y-issue" data-active={active ? 'true' : 'false'}>
      <summary
        onClick={(event) => {
          const details = event.currentTarget.parentElement;
          if (active && details instanceof HTMLDetailsElement && details.open) {
            clearActiveIssue();
            return;
          }
          if (primaryIssueId) {
            window.requestAnimationFrame(() => onSelect(primaryIssueId, 'issue'));
          }
        }}
      >
        <span className="a11y-issue__rule">{violation.ruleId}</span>
        {' '}
        <Impact impact={violation.impact} />
        {' '}
        <ViolationTagChips configuredTags={configuredTags} max={2} violation={violation} />
        {' '}
        <span>{violation.nodes.length} node{violation.nodes.length === 1 ? '' : 's'}</span>
        {' '}
        <span style={{ color: 'var(--fg-muted)' }}>{violation.help}</span>
      </summary>
      <div style={{ paddingTop: 8 }}>
        <a href={violation.helpUrl} target="_blank" rel="noreferrer">
          rule docs
        </a>
        {violation.nodes.map((node, index) => (
          <ViolationNode
            key={index}
            active={makeIssueId(violation.ruleId, index) === activeIssueId}
            canScrollToHotspot={localizedIssueIds.has(makeIssueId(violation.ruleId, index))}
            issueId={makeIssueId(violation.ruleId, index)}
            node={node}
            onSelect={onSelect}
            register={register}
          />
        ))}
      </div>
    </details>
  );
}

function ViolationNode({
  active,
  canScrollToHotspot,
  issueId,
  node,
  onSelect,
  register,
}: {
  active: boolean;
  canScrollToHotspot: boolean;
  issueId: string;
  node: AccessibilityViolationNode;
  onSelect: (issueId: string, sourceSide: 'hotspot' | 'issue') => void;
  register: (issueId: string, element: HTMLElement | null) => void;
}) {
  return (
    <div
      aria-label={canScrollToHotspot ? 'Show matching screenshot hotspot' : 'Issue has no localized screenshot hotspot'}
      className="a11y-issue-node"
      data-active={active ? 'true' : 'false'}
      data-issue-id={issueId}
      onClick={() => {
        if (canScrollToHotspot) onSelect(issueId, 'issue');
      }}
      onKeyDown={(event) => {
        if (!canScrollToHotspot || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onSelect(issueId, 'issue');
      }}
      ref={(element) => register(issueId, element)}
      role="button"
      tabIndex={0}
    >
      <TargetBreadcrumb target={node.target} />
      {node.html ? <pre style={NODE_PRE_STYLE}>{node.html}</pre> : null}
      {node.failureSummary ? <pre style={NODE_PRE_STYLE}>{node.failureSummary}</pre> : null}
    </div>
  );
}

function flashElement(element: HTMLElement | undefined): void {
  if (!element) return;
  element.classList.remove('a11y-flash');
  void element.offsetWidth;
  element.classList.add('a11y-flash');
  window.setTimeout(() => {
    element.classList.remove('a11y-flash');
  }, 1250);
}

function TargetBreadcrumb({ target }: { target: AccessibilityNodeTarget[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {target.map((segment, index) => (
        <code key={index}>
          {Array.isArray(segment) ? segment.join(' > ') : segment}
        </code>
      ))}
    </div>
  );
}

function Impact({ impact }: { impact: AccessibilityViolation['impact'] }) {
  return (
    <span style={{ fontWeight: 700, color: impactColor(impact) }}>
      {impact ?? 'unknown'}
    </span>
  );
}
