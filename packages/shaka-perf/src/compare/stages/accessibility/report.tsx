import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FullReportOnly } from '../../../pipeline/report-mode';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
  StageNote,
} from '../../../pipeline/stage-report-components';
import {
  hotspotZIndex,
  impactColor,
  pct,
  tooltipPlacement,
} from '../../../audit/stages/accessibility/report-utils';
import { ACCESSIBILITY_CSS, SCAN_STYLE } from '../../../audit/stages/accessibility/report-styles';
import type {
  AccessibilityNodeTarget,
  AccessibilityViolationNode,
} from '../../../audit/stages/accessibility/types';
import type {
  AccessibilityCompareFinding,
  AccessibilityCompareResult,
  AccessibilityCompareSide,
  AccessibilityFindingStatus,
  AccessibilitySideScan,
} from './types';

const STATUS_LABEL: Record<AccessibilityFindingStatus, string> = {
  new: 'new in experiment',
  fixed: 'fixed in experiment',
  changed: 'changed',
  unchanged: 'unchanged',
};

const STATUS_COLOR: Record<AccessibilityFindingStatus, string> = {
  new: '#b91c1c',
  fixed: '#137333',
  changed: '#92400e',
  unchanged: 'var(--fg-muted)',
};

const STATUS_MARKER_COLOR: Record<AccessibilityFindingStatus, string> = {
  new: '#dc2626',
  fixed: '#16a34a',
  changed: '#d97706',
  unchanged: '#64748b',
};

const STATUS_MARKER_BACKGROUND: Record<AccessibilityFindingStatus, string> = {
  new: 'rgba(220, 38, 38, 0.16)',
  fixed: 'rgba(22, 163, 74, 0.18)',
  changed: 'rgba(217, 119, 6, 0.18)',
  unchanged: 'rgba(100, 116, 139, 0.16)',
};

const STATUS_ORDER: Record<AccessibilityFindingStatus, number> = {
  new: 0,
  fixed: 1,
  changed: 2,
  unchanged: 3,
};

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  unknown: 4,
};

const CARD_STYLE: CSSProperties = {
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-elevated)',
  padding: 12,
  display: 'grid',
  gap: 12,
};

const SUMMARY_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};

const STATUS_PILL_STYLE: CSSProperties = {
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  padding: '3px 7px',
  fontSize: 11,
  fontWeight: 700,
};

const SIDE_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
};

const COMPARE_DIALOG_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 12,
};

const COMPARE_DIALOG_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 430px)',
  gap: 12,
  minHeight: 0,
};

const COMPARE_SHOT_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
  minWidth: 0,
  minHeight: 0,
  alignContent: 'start',
  overflow: 'auto',
};

const SIDE_CARD_STYLE: CSSProperties = {
  ...SCAN_STYLE,
  minWidth: 0,
};

const FINDING_STYLE: CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: 8,
  display: 'grid',
  gap: 6,
};

const FINDING_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 8,
};

const SIDE_COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'baseline',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--fg-muted)',
  padding: '1px 5px',
};

const NODE_PRE_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: '6px 0 0',
  padding: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
};

const COMPARE_A11Y_CSS = `
.a11y-compare-filter {
  display: grid;
  gap: 8px;
}
.a11y-compare-filter__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
.a11y-compare-filter__actions button,
.a11y-compare-filter__button {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--fg-muted);
  padding: 0 8px;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.a11y-compare-filter__actions button:hover,
.a11y-compare-filter__button:hover {
  border-color: #2563eb;
  color: #1d4ed8;
}
.a11y-compare-filter__button[data-active="true"] {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  border-color: rgba(37, 99, 235, 0.55);
  box-shadow: inset 3px 0 0 #2563eb;
}
.a11y-compare-filter__button[data-active="false"] {
  background: var(--bg-elevated);
}
.a11y-compare-filter__button:disabled {
  border-color: var(--border);
  background: var(--bg-sunken);
  color: var(--fg-muted);
  cursor: not-allowed;
  opacity: 0.42;
  box-shadow: none;
}
.a11y-compare-filter__button-count {
  margin-left: 5px;
  color: inherit;
  opacity: 0.78;
}
.a11y-compare-filter__row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.a11y-compare-filter__label {
  padding-top: 8px;
  color: var(--fg-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.a11y-compare-filter__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.a11y-compare-filter__group {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.a11y-compare-filter__group summary {
  cursor: pointer;
  color: var(--fg-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.a11y-compare-filter__group-body {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.a11y-hotspot[data-extent="page"] {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #111827 !important;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 2px 12px rgba(15, 23, 42, 0.36);
}
.a11y-hotspot[data-extent="page"] .a11y-hotspot__num {
  position: static;
  min-width: 0;
  height: auto;
  padding: 0;
  border-radius: 0;
  background: transparent !important;
  line-height: 1;
}
`;

interface FilterState {
  statuses: Set<AccessibilityFindingStatus>;
  impacts: Set<string>;
  rules: Set<string>;
  tags: Set<string>;
}

interface FilterCountState {
  statuses: Map<AccessibilityFindingStatus, number>;
  impacts: Map<string, number>;
  rules: Map<string, number>;
  tags: Map<string, number>;
}

type FilterKind = keyof FilterState;

interface CompareHotspotEntry {
  finding: AccessibilityCompareFinding;
  node: AccessibilityViolationNode;
  nodeIndex: number;
  side: AccessibilityCompareSide;
}

export function AccessibilityCompareArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AccessibilityCompareResult>[];
}) {
  const rows = measurements.filter((entry) =>
    entry.measurement.summary.errors > 0 || entry.measurement.findings.length > 0,
  );
  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle>accessibility</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((entry) => (
          <div key={entry.viewport.label} className="stage-stack__viewport">
            <AccessibilityCompareViewport
              result={entry.measurement}
              viewportLabel={entry.viewport.label}
            />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function AccessibilityCompareViewport({
  result,
  viewportLabel,
}: {
  result: AccessibilityCompareResult;
  viewportLabel: string;
}) {
  return (
    <div className="stage-section">
      <div className="stage-section__head">{viewportLabel}</div>
      <div style={CARD_STYLE}>
        <div style={SUMMARY_STYLE}>
          <strong>{headlineText(result)}</strong>
          <StatusPill color="#b91c1c" count={result.summary.new} label="new" />
          <StatusPill color="#137333" count={result.summary.fixed} label="fixed" />
          <StatusPill color="#92400e" count={result.summary.changed} label="changed" />
          {result.summary.unchanged > 0 ? (
            <StatusPill color="var(--fg-muted)" count={result.summary.unchanged} label="unchanged" />
          ) : null}
          {result.summary.errors > 0 ? (
            <StatusPill color="#b91c1c" count={result.summary.errors} label="scan error" />
          ) : null}
          <FullReportOnly>
            <RawLinks result={result} />
          </FullReportOnly>
        </div>

        {result.control.error || result.experiment.error ? <ScanErrors result={result} /> : null}

        {result.findings.length > 0 ? (
          <DetailedArtifactDialog
            href={result.comparisonArtifactHref ?? '#'}
            label={`${viewportLabel} accessibility comparison`}
            extra={<CompareDialogMeta result={result} viewportLabel={viewportLabel} />}
            body={<CompareFindingsDialog result={result} viewportLabel={viewportLabel} />}
          >
            inspect accessibility comparison
          </DetailedArtifactDialog>
        ) : result.summary.errors === 0 ? (
          <StageNote body="No accessibility difference between control and experiment." />
        ) : null}
      </div>
    </div>
  );
}

function CompareDialogMeta({
  result,
  viewportLabel,
}: {
  result: AccessibilityCompareResult;
  viewportLabel: string;
}) {
  return (
    <>
      <div>
        <dt>viewport</dt>
        <dd>{viewportLabel}</dd>
      </div>
      <div>
        <dt>new</dt>
        <dd>{result.summary.new}</dd>
      </div>
      <div>
        <dt>fixed</dt>
        <dd>{result.summary.fixed}</dd>
      </div>
      <div>
        <dt>changed</dt>
        <dd>{result.summary.changed}</dd>
      </div>
      <div>
        <dt>unchanged</dt>
        <dd>{result.summary.unchanged}</dd>
      </div>
    </>
  );
}

function CompareFindingsDialog({
  result,
  viewportLabel,
}: {
  result: AccessibilityCompareResult;
  viewportLabel: string;
}) {
  const options = useMemo(() => collectFilterOptions(result.findings), [result.findings]);
  const [filter, setFilter] = useState<FilterState | null>(null);
  const activeFilter = filter ?? defaultFilter(options);
  const findings = useMemo(() =>
    sortFindings(result.findings)
      .filter((finding) => isFindingVisible(finding, activeFilter)),
  [activeFilter, result.findings]);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const hotspotRefs = useRef(new Map<string, HTMLElement>());
  const issueRefs = useRef(new Map<string, HTMLElement>());
  const registerHotspot = useCallback((issueId: string, element: HTMLElement | null) => {
    if (element) hotspotRefs.current.set(issueId, element);
    else hotspotRefs.current.delete(issueId);
  }, []);
  const registerIssue = useCallback((issueId: string, element: HTMLElement | null) => {
    if (element) issueRefs.current.set(issueId, element);
    else issueRefs.current.delete(issueId);
  }, []);
  const selectIssue = useCallback((issueId: string, source: 'hotspot' | 'issue') => {
    setActiveIssueId(issueId);
    const hotspot = hotspotRefs.current.get(issueId);
    const issue = issueRefs.current.get(issueId);
    const details = issue?.closest('details');
    if (details instanceof HTMLDetailsElement) details.open = true;

    window.requestAnimationFrame(() => {
      flashElement(hotspot);
      flashElement(issue);
      if (source === 'issue') hotspot?.scrollIntoView({
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
    <div style={COMPARE_DIALOG_STYLE}>
      <style>{ACCESSIBILITY_CSS}</style>
      <style>{COMPARE_A11Y_CSS}</style>
      <div style={COMPARE_DIALOG_GRID_STYLE}>
        <div className="a11y-dialog__shot">
          <div style={COMPARE_SHOT_GRID_STYLE}>
            <CompareScreenshotPanel
              activeIssueId={activeIssueId}
              findings={findings}
              onSelect={selectIssue}
              registerHotspot={registerHotspot}
              result={result}
              side="control"
              subtitle={sideSubtitle(result, 'control', activeFilter.statuses)}
              title="control"
              viewportLabel={viewportLabel}
            />
            <CompareScreenshotPanel
              activeIssueId={activeIssueId}
              findings={findings}
              onSelect={selectIssue}
              registerHotspot={registerHotspot}
              result={result}
              side="experiment"
              subtitle={sideSubtitle(result, 'experiment', activeFilter.statuses)}
              title="experiment"
              viewportLabel={viewportLabel}
            />
          </div>
        </div>
        <div className="a11y-dialog__issues">
          <div className="a11y-dialog__summary">
            <strong>{viewportLabel}</strong>
            <span style={{ color: '#b91c1c', fontWeight: 700 }}>
              {findings.length === result.findings.length
                ? `${findings.length} finding${findings.length === 1 ? '' : 's'}`
                : `${findings.length} of ${result.findings.length} findings`}
            </span>
          </div>
          <div className="a11y-dialog__filter">
            <AccessibilityCompareFilters
              filter={activeFilter}
              findings={result.findings}
              options={options}
              setFilter={setFilter}
            />
          </div>
          {findings.length > 0 ? (
            findings.map((finding) => (
              <FindingDetails
                activeIssueId={activeIssueId}
                finding={finding}
                key={finding.signature}
                onSelect={selectIssue}
                registerIssue={registerIssue}
              />
            ))
          ) : (
            <StageNote body="No accessibility differences match the current view." />
          )}
        </div>
      </div>
      <FullReportOnly>
        <RawLinks result={result} />
      </FullReportOnly>
    </div>
  );
}

function AccessibilityCompareFilters({
  filter,
  findings,
  options,
  setFilter,
}: {
  filter: FilterState;
  findings: readonly AccessibilityCompareFinding[];
  options: FilterState;
  setFilter: (filter: FilterState) => void;
}) {
  const counts = useMemo(() => countFilterOptions(findings, options), [findings, options]);
  const disabled = useMemo(
    () => disabledFilterOptions(findings, filter, options),
    [filter, findings, options],
  );
  return (
    <div className="a11y-compare-filter">
      <div className="a11y-compare-filter__actions">
        <button type="button" onClick={() => setFilter(defaultFilter(options))}>
          reset
        </button>
        <button type="button" onClick={() => setFilter(emptyFilter())}>
          none
        </button>
        <button type="button" onClick={() => setFilter(options)}>
          all
        </button>
      </div>
      <FilterRow
        allValues={options.statuses}
        counts={counts.statuses}
        disabledValues={disabled.statuses}
        label="status"
        selected={filter.statuses}
        setSelected={(statuses) => setFilter({ ...filter, statuses: statuses as Set<AccessibilityFindingStatus> })}
        valueLabel={(value) => STATUS_LABEL[value as AccessibilityFindingStatus]}
      />
      <FilterRow
        allValues={options.impacts}
        counts={counts.impacts}
        disabledValues={disabled.impacts}
        label="impact"
        selected={filter.impacts}
        setSelected={(impacts) => setFilter({ ...filter, impacts })}
      />
      <details className="a11y-compare-filter__group">
        <summary>advanced filters</summary>
        <div className="a11y-compare-filter__group-body">
          <FilterRow
            allValues={options.rules}
            counts={counts.rules}
            disabledValues={disabled.rules}
            label="rules"
            selected={filter.rules}
            setSelected={(rules) => setFilter({ ...filter, rules })}
          />
          <FilterRow
            allValues={options.tags}
            counts={counts.tags}
            disabledValues={disabled.tags}
            label="tags"
            selected={filter.tags}
            setSelected={(tags) => setFilter({ ...filter, tags })}
          />
        </div>
      </details>
    </div>
  );
}

function FilterRow({
  allValues,
  counts,
  disabledValues,
  label,
  selected,
  setSelected,
  valueLabel,
}: {
  allValues: ReadonlySet<string>;
  counts: ReadonlyMap<string, number>;
  disabledValues: ReadonlySet<string>;
  label: string;
  selected: ReadonlySet<string>;
  setSelected: (selected: Set<string>) => void;
  valueLabel?: (value: string) => string;
}) {
  if (allValues.size === 0) return null;
  const values = [...allValues];
  return (
    <div className="a11y-compare-filter__row">
      <span className="a11y-compare-filter__label">{label}</span>
      <div className="a11y-compare-filter__choices">
        {values.map((value) => (
          <button
            type="button"
            key={value}
            className="a11y-compare-filter__button"
            data-active={selected.has(value) ? 'true' : 'false'}
            disabled={disabledValues.has(value)}
            aria-pressed={selected.has(value)}
            title={
              disabledValues.has(value)
                ? `${valueLabel ? valueLabel(value) : value} will not affect the current filtered view`
                : undefined
            }
            onClick={() => {
              const next = new Set(selected);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setSelected(next);
            }}
          >
            <span>{valueLabel ? valueLabel(value) : value}</span>
            <span className="a11y-compare-filter__button-count">
              {counts.get(value) ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function disabledFilterOptions(
  findings: readonly AccessibilityCompareFinding[],
  filter: FilterState,
  options: FilterState,
): FilterState {
  const visibleCount = countVisibleFindings(findings, filter);
  return {
    statuses: disabledValuesForKind(findings, filter, options.statuses, 'statuses', visibleCount) as Set<AccessibilityFindingStatus>,
    impacts: disabledValuesForKind(findings, filter, options.impacts, 'impacts', visibleCount),
    rules: disabledValuesForKind(findings, filter, options.rules, 'rules', visibleCount),
    tags: disabledValuesForKind(findings, filter, options.tags, 'tags', visibleCount),
  };
}

function disabledValuesForKind<T extends string>(
  findings: readonly AccessibilityCompareFinding[],
  filter: FilterState,
  values: ReadonlySet<T>,
  kind: FilterKind,
  visibleCount: number,
): Set<T> {
  const disabled = new Set<T>();
  for (const value of values) {
    const nextFilter = toggleFilterValue(filter, kind, value);
    if (countVisibleFindings(findings, nextFilter) === visibleCount) {
      disabled.add(value);
    }
  }
  return disabled;
}

function toggleFilterValue(filter: FilterState, kind: FilterKind, value: string): FilterState {
  const next = {
    statuses: new Set(filter.statuses),
    impacts: new Set(filter.impacts),
    rules: new Set(filter.rules),
    tags: new Set(filter.tags),
  };
  const target = next[kind] as Set<string>;
  if (target.has(value)) target.delete(value);
  else target.add(value);
  return next;
}

function countVisibleFindings(
  findings: readonly AccessibilityCompareFinding[],
  filter: FilterState,
): number {
  return findings.filter((finding) => isFindingVisible(finding, filter)).length;
}

function countFilterOptions(
  findings: readonly AccessibilityCompareFinding[],
  options: FilterState,
): FilterCountState {
  const counts: FilterCountState = {
    statuses: new Map([...options.statuses].map((value) => [value, 0])),
    impacts: new Map([...options.impacts].map((value) => [value, 0])),
    rules: new Map([...options.rules].map((value) => [value, 0])),
    tags: new Map([...options.tags].map((value) => [value, 0])),
  };

  for (const finding of findings) {
    incrementCount(counts.statuses, finding.status);
    incrementCount(counts.impacts, finding.impact ?? 'unknown');
    incrementCount(counts.rules, finding.ruleId);
    for (const tag of finding.tags) incrementCount(counts.tags, tag);
  }

  return counts;
}

function incrementCount<T extends string>(counts: Map<T, number>, value: T): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function StatusPill({
  color,
  count,
  label,
}: {
  color: string;
  count: number;
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <span style={{ ...STATUS_PILL_STYLE, color }}>
      {count} {label}
    </span>
  );
}

function CompareScreenshotPanel({
  activeIssueId,
  findings,
  onSelect,
  registerHotspot,
  result,
  side,
  subtitle,
  title,
  viewportLabel,
}: {
  activeIssueId: string | null;
  findings: readonly AccessibilityCompareFinding[];
  onSelect: (issueId: string, source: 'hotspot' | 'issue') => void;
  registerHotspot: (issueId: string, element: HTMLElement | null) => void;
  result: AccessibilityCompareResult;
  side: AccessibilityCompareSide;
  subtitle: string;
  title: string;
  viewportLabel: string;
}) {
  const sideScan = side === 'control' ? result.control : result.experiment;
  const source = sideScan.screenshot?.imageHref ?? sideScan.screenshot?.imageDataUri;
  const hotspots = useMemo(
    () => compareHotspotsForSide(findings, side),
    [findings, side],
  );
  return (
    <div style={SIDE_CARD_STYLE}>
      <div style={SUMMARY_STYLE}>
        <strong>{title}</strong>
        <span style={{ color: 'var(--fg-muted)' }}>{subtitle}</span>
      </div>
      <div style={{ color: 'var(--fg-muted)', overflowWrap: 'anywhere' }}>{sideScan.url}</div>
      {sideScan.error ? <StageNote label={title} body={sideScan.error} /> : null}
      {source && sideScan.screenshot ? (
        <div style={{ marginTop: 10, overflow: 'auto', border: '1px solid var(--border)' }}>
          <div
            style={{
              position: 'relative',
              width: 'max-content',
              maxWidth: '100%',
              background: 'var(--bg-sunken)',
            }}
          >
            <img
              src={source}
              width={sideScan.screenshot.width}
              height={sideScan.screenshot.height}
              alt={`${viewportLabel} ${side} accessibility screenshot`}
              loading="lazy"
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            />
            {hotspots.map((hotspot, index) => (
              <CompareHotspot
                active={activeIssueId === makeCompareIssueId(hotspot.finding, hotspot.side, hotspot.nodeIndex)}
                hotspot={hotspot}
                index={index + 1}
                issueId={makeCompareIssueId(hotspot.finding, hotspot.side, hotspot.nodeIndex)}
                key={makeCompareIssueId(hotspot.finding, hotspot.side, hotspot.nodeIndex)}
                onSelect={onSelect}
                register={registerHotspot}
                screenshot={sideScan.screenshot!}
              />
            ))}
          </div>
        </div>
      ) : !sideScan.error ? (
        <StageNote body={sideCleanText(result, side)} />
      ) : null}
      <FullReportOnly>
        {sideRawArtifactHref(result, side) ? (
          <a href={sideRawArtifactHref(result, side)} target="_blank" rel="noreferrer">raw JSON</a>
        ) : null}
      </FullReportOnly>
    </div>
  );
}

function CompareHotspot({
  active,
  hotspot,
  index,
  issueId,
  onSelect,
  register,
  screenshot,
}: {
  active: boolean;
  hotspot: CompareHotspotEntry;
  index: number;
  issueId: string;
  onSelect: (issueId: string, source: 'hotspot' | 'issue') => void;
  register: (issueId: string, element: HTMLElement | null) => void;
  screenshot: NonNullable<AccessibilitySideScan['screenshot']>;
}) {
  const bounds = hotspot.node.bounds!;
  const placement = tooltipPlacement(bounds, screenshot);
  const color = STATUS_MARKER_COLOR[hotspot.finding.status];
  const pageExtent = isPageExtentHotspot(bounds, screenshot);
  const style: CSSProperties = pageExtent
    ? compactHotspotStyle(bounds, screenshot, color)
    : {
      left: pct(bounds.x, screenshot.width),
      top: pct(bounds.y, screenshot.height),
      width: pct(bounds.width, screenshot.width),
      height: pct(bounds.height, screenshot.height),
      zIndex: hotspotZIndex(bounds.width, bounds.height, screenshot.width, screenshot.height),
      borderColor: color,
      background: STATUS_MARKER_BACKGROUND[hotspot.finding.status],
    };
  return (
    <div
      className="a11y-hotspot"
      data-active={active ? 'true' : 'false'}
      data-extent={pageExtent ? 'page' : 'node'}
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
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`${hotspot.finding.ruleId}: ${STATUS_LABEL[hotspot.finding.status]}`}
    >
      <span className="a11y-hotspot__num" style={{ background: color }}>{index}</span>
      <div className="a11y-tooltip">
        <div className="a11y-tooltip__title">
          <strong>{hotspot.finding.ruleId}</strong>
          <span style={{ color: STATUS_COLOR[hotspot.finding.status], fontWeight: 700 }}>
            {STATUS_LABEL[hotspot.finding.status]}
          </span>
          <span style={{ color: impactColor(hotspot.finding.impact), fontWeight: 700 }}>
            {hotspot.finding.impact ?? 'unknown'}
          </span>
        </div>
        <div className="a11y-tooltip__help">
          {hotspot.finding.experiment?.help ?? hotspot.finding.control?.help}
        </div>
        <Target target={hotspot.node.target} />
        {hotspot.node.html ? <pre>{hotspot.node.html}</pre> : null}
        {hotspot.node.failureSummary ? <pre>{hotspot.node.failureSummary}</pre> : null}
      </div>
    </div>
  );
}

function isPageExtentHotspot(
  bounds: AccessibilityViolationNode['bounds'],
  screenshot: NonNullable<AccessibilitySideScan['screenshot']>,
): boolean {
  if (!bounds) return false;
  const widthRatio = bounds.width / screenshot.width;
  const heightRatio = bounds.height / screenshot.height;
  const areaRatio = (bounds.width * bounds.height) / (screenshot.width * screenshot.height);
  return areaRatio > 0.45 || (widthRatio > 0.82 && heightRatio > 0.55);
}

function compactHotspotStyle(
  bounds: NonNullable<AccessibilityViolationNode['bounds']>,
  screenshot: NonNullable<AccessibilitySideScan['screenshot']>,
  color: string,
): CSSProperties {
  const markerSize = 22;
  const x = Math.min(Math.max(bounds.x + 8, 0), Math.max(0, screenshot.width - markerSize));
  const y = Math.min(Math.max(bounds.y + 8, 0), Math.max(0, screenshot.height - markerSize));
  return {
    left: pct(x, screenshot.width),
    top: pct(y, screenshot.height),
    width: markerSize,
    height: markerSize,
    zIndex: 100,
    borderColor: color,
  };
}

function FindingDetails({
  activeIssueId,
  finding,
  onSelect,
  registerIssue,
}: {
  activeIssueId: string | null;
  finding: AccessibilityCompareFinding;
  onSelect: (issueId: string, source: 'hotspot' | 'issue') => void;
  registerIssue: (issueId: string, element: HTMLElement | null) => void;
}) {
  const nodeCount = (finding.control?.nodes.length ?? 0) + (finding.experiment?.nodes.length ?? 0);
  const issueIds = [
    ...(finding.control?.nodes.map((_, index) => makeCompareIssueId(finding, 'control', index)) ?? []),
    ...(finding.experiment?.nodes.map((_, index) => makeCompareIssueId(finding, 'experiment', index)) ?? []),
  ];
  const active = issueIds.includes(activeIssueId ?? '');
  const primaryIssueId = firstLocalizedIssueId(finding);
  return (
    <details className="a11y-issue" data-active={active ? 'true' : 'false'} style={FINDING_STYLE}>
      <summary
        style={{ cursor: 'pointer' }}
        onClick={() => {
          if (primaryIssueId) window.requestAnimationFrame(() => onSelect(primaryIssueId, 'issue'));
        }}
      >
        <span style={FINDING_HEAD_STYLE}>
          <strong>{finding.ruleId}</strong>
          <span style={{ color: STATUS_COLOR[finding.status], fontWeight: 700 }}>
            {STATUS_LABEL[finding.status]}
          </span>
          <span style={{ color: impactColor(finding.impact), fontWeight: 700 }}>
            {finding.impact ?? 'unknown'}
          </span>
          <span style={{ color: 'var(--fg-muted)' }}>
            {nodeCount} affected node{nodeCount === 1 ? '' : 's'}
          </span>
          <SideNodeSummary finding={finding} />
        </span>
      </summary>
      <div style={{ color: 'var(--fg-muted)', marginTop: 6 }}>
        {finding.experiment?.help ?? finding.control?.help}
      </div>
      <div style={{ ...SIDE_GRID_STYLE, marginTop: 8 }}>
        <SidePanel
          activeIssueId={activeIssueId}
          finding={finding}
          findingSide={finding.control}
          onSelect={onSelect}
          registerIssue={registerIssue}
          side="control"
        />
        <SidePanel
          activeIssueId={activeIssueId}
          finding={finding}
          findingSide={finding.experiment}
          onSelect={onSelect}
          registerIssue={registerIssue}
          side="experiment"
        />
      </div>
    </details>
  );
}

function SideNodeSummary({ finding }: { finding: AccessibilityCompareFinding }) {
  return (
    <>
      <span style={SIDE_COUNT_STYLE}>
        <span>control:</span>
        <strong>{finding.control?.nodes.length ?? 0}</strong>
      </span>
      <span style={SIDE_COUNT_STYLE}>
        <span>experiment:</span>
        <strong>{finding.experiment?.nodes.length ?? 0}</strong>
      </span>
    </>
  );
}

function SidePanel({
  activeIssueId,
  finding,
  findingSide,
  onSelect,
  registerIssue,
  side,
}: {
  activeIssueId: string | null;
  finding: AccessibilityCompareFinding;
  findingSide: AccessibilityCompareFinding['control'];
  onSelect: (issueId: string, source: 'hotspot' | 'issue') => void;
  registerIssue: (issueId: string, element: HTMLElement | null) => void;
  side: AccessibilityCompareSide;
}) {
  return (
    <section style={{ border: '1px solid var(--border-strong)', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{side}</strong>
      </div>
      {findingSide ? (
        <div style={{ marginTop: 8 }}>
          <a href={findingSide.helpUrl} target="_blank" rel="noreferrer">rule docs</a>
          {findingSide.nodes.map((node, index) => (
            <div
              aria-label={node.bounds ? 'Show matching screenshot hotspot' : 'Issue has no localized screenshot hotspot'}
              className="a11y-issue-node"
              data-active={makeCompareIssueId(finding, side, index) === activeIssueId ? 'true' : 'false'}
              data-issue-id={makeCompareIssueId(finding, side, index)}
              key={index}
              onClick={() => {
                if (node.bounds) onSelect(makeCompareIssueId(finding, side, index), 'issue');
              }}
              onKeyDown={(event) => {
                if (!node.bounds || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                onSelect(makeCompareIssueId(finding, side, index), 'issue');
              }}
              ref={(element) => registerIssue(makeCompareIssueId(finding, side, index), element)}
              role="button"
              style={{ marginTop: 8 }}
              tabIndex={node.bounds ? 0 : -1}
            >
              <Target target={node.target} />
              {node.html ? <pre style={NODE_PRE_STYLE}>{node.html}</pre> : null}
              {node.failureSummary ? <pre style={NODE_PRE_STYLE}>{node.failureSummary}</pre> : null}
            </div>
          ))}
        </div>
      ) : (
        <StageNote body={`No matching finding on ${side}.`} />
      )}
    </section>
  );
}

function ScanErrors({ result }: { result: AccessibilityCompareResult }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {result.control.error ? <StageNote label="control" body={result.control.error} /> : null}
      {result.experiment.error ? <StageNote label="experiment" body={result.experiment.error} /> : null}
    </div>
  );
}

function RawLinks({ result }: { result: AccessibilityCompareResult }) {
  const links = [
    ['control raw', result.control.rawArtifactHref],
    ['experiment raw', result.experiment.rawArtifactHref],
    ['comparison JSON', result.comparisonArtifactHref],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (links.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8 }}>
      {links.map(([label, href]) => (
        <a href={href} key={label} target="_blank" rel="noreferrer">{label}</a>
      ))}
    </span>
  );
}

function Target({
  target,
}: {
  target: AccessibilityNodeTarget[];
}) {
  const parts = target.map((segment) =>
    Array.isArray(segment) ? segment.join(' > ') : segment,
  );
  return <code>{parts.join(' -> ')}</code>;
}

function headlineText(result: AccessibilityCompareResult): string {
  if (result.summary.errors > 0) return 'Accessibility scan did not complete';
  if (result.summary.new > 0) return 'Accessibility regressed in experiment';
  if (result.summary.changed > 0) return 'Accessibility changed between versions';
  if (result.summary.fixed > 0) return 'Accessibility improved in experiment';
  return 'No accessibility difference';
}

function sideSubtitle(
  result: AccessibilityCompareResult,
  side: AccessibilityCompareSide,
  visibleStatuses: ReadonlySet<AccessibilityFindingStatus>,
): string {
  const counts = side === 'control'
    ? [
      visibleStatuses.has('fixed') ? countText(result.summary.fixed, 'fixed here') : null,
      visibleStatuses.has('changed') ? countText(result.summary.changed, 'changed') : null,
      visibleStatuses.has('unchanged') ? countText(result.summary.unchanged, 'unchanged') : null,
    ]
    : [
      visibleStatuses.has('new') ? countText(result.summary.new, 'new here') : null,
      visibleStatuses.has('changed') ? countText(result.summary.changed, 'changed') : null,
      visibleStatuses.has('unchanged') ? countText(result.summary.unchanged, 'unchanged') : null,
    ];
  return counts.filter(Boolean).join(' · ') || 'no visible differences';
}

function sideCleanText(result: AccessibilityCompareResult, side: AccessibilityCompareSide): string {
  if (result.summary.errors > 0) return 'No screenshot findings available because this side did not scan cleanly.';
  if (side === 'control' && result.summary.new > 0) return 'No control-side match. These findings are new in experiment.';
  if (side === 'experiment' && result.summary.fixed > 0) return 'No experiment-side match. These findings were fixed.';
  return 'No visible accessibility differences on this side.';
}

function countText(count: number, label: string): string | null {
  return count > 0 ? `${count} ${label}` : null;
}

function collectFilterOptions(findings: readonly AccessibilityCompareFinding[]): FilterState {
  const statuses = new Set<AccessibilityFindingStatus>();
  const impacts = new Set<string>();
  const rules = new Set<string>();
  const tags = new Set<string>();
  for (const finding of findings) {
    statuses.add(finding.status);
    impacts.add(finding.impact ?? 'unknown');
    rules.add(finding.ruleId);
    for (const tag of finding.tags) tags.add(tag);
  }
  return {
    statuses: sortedSet(statuses, (value) => STATUS_ORDER[value]),
    impacts: sortedSet(impacts, (value) => IMPACT_ORDER[value] ?? 99),
    rules: sortedSet(rules),
    tags: sortedSet(tags),
  };
}

function defaultFilter(options: FilterState): FilterState {
  const defaultStatuses = [...options.statuses].filter((status) => status !== 'unchanged');
  return {
    statuses: new Set(defaultStatuses.length > 0 ? defaultStatuses : options.statuses),
    impacts: new Set(options.impacts),
    rules: new Set(options.rules),
    tags: new Set(options.tags),
  };
}

function emptyFilter(): FilterState {
  return {
    statuses: new Set(),
    impacts: new Set(),
    rules: new Set(),
    tags: new Set(),
  };
}

function sortedSet<T extends string>(
  values: ReadonlySet<T>,
  rank: (value: T) => number = () => 0,
): Set<T> {
  return new Set([...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)));
}

function isFindingVisible(finding: AccessibilityCompareFinding, filter: FilterState): boolean {
  return filter.statuses.has(finding.status) &&
    filter.impacts.has(finding.impact ?? 'unknown') &&
    filter.rules.has(finding.ruleId) &&
    (finding.tags.length === 0 || finding.tags.some((tag) => filter.tags.has(tag)));
}

function sideRawArtifactHref(
  result: AccessibilityCompareResult,
  side: AccessibilityCompareSide,
): string | undefined {
  return side === 'control' ? result.control.rawArtifactHref : result.experiment.rawArtifactHref;
}

function compareHotspotsForSide(
  findings: readonly AccessibilityCompareFinding[],
  side: AccessibilityCompareSide,
): CompareHotspotEntry[] {
  return findings.flatMap((finding) => {
    const findingSide = side === 'control' ? finding.control : finding.experiment;
    if (!findingSide) return [];
    return findingSide.nodes
      .map((node, nodeIndex) => ({ finding, node, nodeIndex, side }))
      .filter((entry) => entry.node.bounds != null);
  });
}

function firstLocalizedIssueId(finding: AccessibilityCompareFinding): string | null {
  const sides: AccessibilityCompareSide[] = ['control', 'experiment'];
  for (const side of sides) {
    const findingSide = side === 'control' ? finding.control : finding.experiment;
    const index = findingSide?.nodes.findIndex((node) => node.bounds != null) ?? -1;
    if (index >= 0) return makeCompareIssueId(finding, side, index);
  }
  return null;
}

function makeCompareIssueId(
  finding: AccessibilityCompareFinding,
  side: AccessibilityCompareSide,
  nodeIndex: number,
): string {
  return `${side}:${finding.signature}:${nodeIndex}`;
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

function sortFindings(findings: readonly AccessibilityCompareFinding[]): AccessibilityCompareFinding[] {
  return [...findings].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (IMPACT_ORDER[a.impact ?? 'unknown'] ?? 99) - (IMPACT_ORDER[b.impact ?? 'unknown'] ?? 99) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.signature.localeCompare(b.signature),
  );
}
