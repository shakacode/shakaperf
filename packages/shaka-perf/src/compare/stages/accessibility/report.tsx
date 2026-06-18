import { useMemo, useState, type CSSProperties } from 'react';
import { FullReportOnly } from '../../../pipeline/report-mode';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
  StageNote,
} from '../../../pipeline/stage-report-components';
import type {
  AccessibilityCompareFinding,
  AccessibilityCompareResult,
  AccessibilityCompareSide,
  AccessibilityFindingStatus,
  AccessibilitySideScan,
} from './types';
import type { AccessibilityNodeTarget } from '../../../audit/stages/accessibility/types';

const STATUS_LABEL: Record<AccessibilityFindingStatus, string> = {
  new: 'new',
  fixed: 'fixed',
  changed: 'changed',
  unchanged: 'unchanged',
};

const STATUS_COLOR: Record<AccessibilityFindingStatus, string> = {
  new: '#b91c1c',
  fixed: '#137333',
  changed: '#92400e',
  unchanged: 'var(--fg-muted)',
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
  gap: 10,
};

const SUMMARY_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};

const FILTER_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
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

const NODE_PRE_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: '6px 0 0',
  padding: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
};

interface FilterState {
  statuses: Set<AccessibilityFindingStatus>;
  impacts: Set<string>;
  rules: Set<string>;
  tags: Set<string>;
}

export function AccessibilityCompareArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AccessibilityCompareResult>[];
}) {
  const rows = measurements.filter((entry) =>
    entry.measurement.summary.errors > 0 || entry.measurement.findings.length > 0,
  );
  const options = useMemo(() => collectFilterOptions(rows), [rows]);
  const [filter, setFilter] = useState<FilterState | null>(null);
  const activeFilter = filter ?? defaultFilter(options);

  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle>accessibility</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((entry) => (
          <div key={entry.viewport.label} className="stage-stack__viewport">
            <AccessibilityCompareViewport
              filter={activeFilter}
              options={options}
              result={entry.measurement}
              setFilter={setFilter}
              viewportLabel={entry.viewport.label}
            />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function AccessibilityCompareViewport({
  filter,
  options,
  result,
  setFilter,
  viewportLabel,
}: {
  filter: FilterState;
  options: FilterState;
  result: AccessibilityCompareResult;
  setFilter: (filter: FilterState) => void;
  viewportLabel: string;
}) {
  const findings = useMemo(() =>
    sortFindings(result.findings).filter((finding) => isFindingVisible(finding, filter)),
  [filter, result.findings]);
  const total = result.findings.length;
  return (
    <div className="stage-section">
      <div className="stage-section__head">{viewportLabel}</div>
      <div style={CARD_STYLE}>
        <div style={SUMMARY_STYLE}>
          <strong>{summaryText(result)}</strong>
          {result.summary.errors > 0 ? <span style={{ color: '#b91c1c' }}>scan error</span> : null}
          <FullReportOnly>
            <RawLinks result={result} />
          </FullReportOnly>
        </div>
        <AccessibilityCompareFilters
          filter={filter}
          options={options}
          setFilter={setFilter}
        />
        {result.control.error || result.experiment.error ? <ScanErrors result={result} /> : null}
        {findings.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {findings.map((finding) => (
              <FindingRow
                finding={finding}
                key={finding.signature}
                result={result}
                viewportLabel={viewportLabel}
              />
            ))}
          </div>
        ) : total > 0 ? (
          <StageNote body="No accessibility findings match the selected filters." />
        ) : result.summary.errors === 0 ? (
          <StageNote body="No meaningful accessibility difference." />
        ) : null}
      </div>
    </div>
  );
}

function AccessibilityCompareFilters({
  filter,
  options,
  setFilter,
}: {
  filter: FilterState;
  options: FilterState;
  setFilter: (filter: FilterState) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <FilterRow
        allValues={options.statuses}
        label="status"
        selected={filter.statuses}
        setSelected={(statuses) => setFilter({ ...filter, statuses: statuses as Set<AccessibilityFindingStatus> })}
      />
      <FilterRow
        allValues={options.impacts}
        label="impact"
        selected={filter.impacts}
        setSelected={(impacts) => setFilter({ ...filter, impacts })}
      />
      <FilterRow
        allValues={options.tags}
        label="tags"
        selected={filter.tags}
        setSelected={(tags) => setFilter({ ...filter, tags })}
      />
      <FilterRow
        allValues={options.rules}
        label="rules"
        selected={filter.rules}
        setSelected={(rules) => setFilter({ ...filter, rules })}
      />
    </div>
  );
}

function FilterRow({
  allValues,
  label,
  selected,
  setSelected,
}: {
  allValues: ReadonlySet<string>;
  label: string;
  selected: ReadonlySet<string>;
  setSelected: (selected: Set<string>) => void;
}) {
  if (allValues.size === 0) return null;
  const values = [...allValues];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--fg-muted)', minWidth: 56 }}>{label}</span>
      <div style={FILTER_STYLE}>
        {values.map((value) => (
          <button
            type="button"
            key={value}
            data-active={selected.has(value) ? 'true' : 'false'}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setSelected(next);
            }}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  result,
  viewportLabel,
}: {
  finding: AccessibilityCompareFinding;
  result: AccessibilityCompareResult;
  viewportLabel: string;
}) {
  const nodeCount = (finding.control?.nodes.length ?? 0) + (finding.experiment?.nodes.length ?? 0);
  const sideLabel = finding.status === 'new'
    ? 'experiment only'
    : finding.status === 'fixed'
      ? 'control only'
      : 'control + experiment';
  return (
    <div style={FINDING_STYLE}>
      <div style={FINDING_HEAD_STYLE}>
        <strong>{finding.ruleId}</strong>
        <span style={{ color: STATUS_COLOR[finding.status], fontWeight: 700 }}>
          {STATUS_LABEL[finding.status]}
        </span>
        <span style={{ color: impactColor(finding.impact), fontWeight: 700 }}>
          {finding.impact ?? 'unknown'}
        </span>
        <span style={{ color: 'var(--fg-muted)' }}>
          {nodeCount} node{nodeCount === 1 ? '' : 's'} · {sideLabel}
        </span>
      </div>
      <div style={{ color: 'var(--fg-muted)' }}>
        {finding.experiment?.help ?? finding.control?.help}
      </div>
      {finding.tags.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {finding.tags.map((tag) => <code key={tag}>{tag}</code>)}
        </div>
      ) : null}
      <DetailedArtifactDialog
        href={result.comparisonArtifactHref ?? '#'}
        label={`${viewportLabel} accessibility ${finding.ruleId}`}
        extra={<FindingMeta finding={finding} viewportLabel={viewportLabel} />}
        body={<FindingDialog finding={finding} result={result} />}
      >
        details
      </DetailedArtifactDialog>
    </div>
  );
}

function FindingMeta({
  finding,
  viewportLabel,
}: {
  finding: AccessibilityCompareFinding;
  viewportLabel: string;
}) {
  return (
    <>
      <div>
        <dt>viewport</dt>
        <dd>{viewportLabel}</dd>
      </div>
      <div>
        <dt>status</dt>
        <dd>{finding.status}</dd>
      </div>
      <div>
        <dt>rule</dt>
        <dd>{finding.ruleId}</dd>
      </div>
      <div>
        <dt>impact</dt>
        <dd>{finding.impact ?? 'unknown'}</dd>
      </div>
    </>
  );
}

function FindingDialog({
  finding,
  result,
}: {
  finding: AccessibilityCompareFinding;
  result: AccessibilityCompareResult;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <SidePanel side="control" sideScan={result.control} findingSide={finding.control} />
        <SidePanel side="experiment" sideScan={result.experiment} findingSide={finding.experiment} />
      </div>
      <FullReportOnly>
        <RawLinks result={result} />
      </FullReportOnly>
    </div>
  );
}

function SidePanel({
  findingSide,
  side,
  sideScan,
}: {
  findingSide: AccessibilityCompareFinding['control'];
  side: AccessibilityCompareSide;
  sideScan: AccessibilitySideScan;
}) {
  const source = sideScan.screenshot?.imageHref ?? sideScan.screenshot?.imageDataUri;
  return (
    <section style={{ border: '1px solid var(--border-strong)', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{side}</strong>
        {sideScan.error ? <span style={{ color: '#b91c1c' }}>error</span> : null}
      </div>
      <div style={{ color: 'var(--fg-muted)', overflowWrap: 'anywhere' }}>{sideScan.url}</div>
      {source ? (
        <a href={source} target="_blank" rel="noreferrer">
          <img
            src={source}
            alt={`${side} screenshot`}
            loading="lazy"
            style={{
              display: 'block',
              width: '100%',
              maxHeight: 260,
              objectFit: 'contain',
              border: '1px solid var(--border)',
              marginTop: 8,
            }}
          />
        </a>
      ) : null}
      {sideScan.error ? <pre style={NODE_PRE_STYLE}>{sideScan.error}</pre> : null}
      {findingSide ? (
        <div style={{ marginTop: 8 }}>
          <a href={findingSide.helpUrl} target="_blank" rel="noreferrer">rule docs</a>
          {findingSide.nodes.map((node, index) => (
            <div key={index} style={{ marginTop: 8 }}>
              <Target target={node.target} />
              {node.html ? <pre style={NODE_PRE_STYLE}>{node.html}</pre> : null}
              {node.failureSummary ? <pre style={NODE_PRE_STYLE}>{node.failureSummary}</pre> : null}
            </div>
          ))}
        </div>
      ) : !sideScan.error ? (
        <StageNote body={`No matching finding on ${side}.`} />
      ) : null}
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

function summaryText(result: AccessibilityCompareResult): string {
  const parts = [
    countText(result.summary.new, 'new'),
    countText(result.summary.fixed, 'fixed'),
    countText(result.summary.changed, 'changed'),
    countText(result.summary.unchanged, 'unchanged'),
  ].filter(Boolean);
  if (result.summary.errors > 0) parts.unshift(countText(result.summary.errors, 'error'));
  return parts.length > 0 ? parts.join(' · ') : 'clean';
}

function countText(count: number, label: string): string | null {
  return count > 0 ? `${count} ${label}` : null;
}

function collectFilterOptions(
  rows: readonly StageRenderEntry<AccessibilityCompareResult>[],
): FilterState {
  const statuses = new Set<AccessibilityFindingStatus>();
  const impacts = new Set<string>();
  const rules = new Set<string>();
  const tags = new Set<string>();
  for (const { measurement } of rows) {
    for (const finding of measurement.findings) {
      statuses.add(finding.status);
      impacts.add(finding.impact ?? 'unknown');
      rules.add(finding.ruleId);
      for (const tag of finding.tags) tags.add(tag);
    }
  }
  return {
    statuses: sortedSet(statuses, (value) => STATUS_ORDER[value]),
    impacts: sortedSet(impacts, (value) => IMPACT_ORDER[value] ?? 99),
    rules: sortedSet(rules),
    tags: sortedSet(tags),
  };
}

function defaultFilter(options: FilterState): FilterState {
  return {
    statuses: new Set([...options.statuses].filter((status) => status !== 'unchanged')),
    impacts: new Set(options.impacts),
    rules: new Set(options.rules),
    tags: new Set(options.tags),
  };
}

const STATUS_ORDER: Record<AccessibilityFindingStatus, number> = {
  new: 0,
  changed: 1,
  fixed: 2,
  unchanged: 3,
};

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

function sortFindings(findings: readonly AccessibilityCompareFinding[]): AccessibilityCompareFinding[] {
  return [...findings].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (IMPACT_ORDER[a.impact ?? 'unknown'] ?? 99) - (IMPACT_ORDER[b.impact ?? 'unknown'] ?? 99) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.signature.localeCompare(b.signature),
  );
}

function impactColor(impact: AccessibilityCompareFinding['impact']): string {
  return impact === 'critical' || impact === 'serious' ? '#b91c1c' : '#92400e';
}
