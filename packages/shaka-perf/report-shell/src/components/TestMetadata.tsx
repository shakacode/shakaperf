/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useState, type ReactNode } from 'react';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import { SourceText } from './SourceText';
import type { ReportMeta, ReportOutcome, TestResult } from '../types';
import { MeasurementCommand, RunCommits } from './RunDetails';
import { pipelineTroubleshootCommands, renderPipelineTestCardUrls } from '../../../src/pipeline/pipeline-artifacts';

// Full-word units so "12m" isn't mistaken for "12 months" — especially
// relevant in merged --report-only views where artifacts can be weeks old.
function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function formatMeasuredAt(measuredAt: number | null): string | null {
  if (measuredAt == null) return 'never measured';
  const diffMs = Date.now() - measuredAt;
  if (diffMs < 0) return 'just now';
  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (diffMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return `${pluralize(mins, 'minute')} ago`;
  }
  if (days === 0) return `${pluralize(hours, 'hour')} ago`;
  if (hours === 0) return `${pluralize(days, 'day')} ago`;
  return `${pluralize(days, 'day')} ${pluralize(hours, 'hour')} ago`;
}

interface MetadataProps {
  meta: ReportMeta;
  test: TestResult;
  actions?: ReactNode;
}

interface PanelLayout {
  expanded?: boolean;
  onToggleExpanded?: () => void;
  defaultExpanded?: boolean;
  variant?: 'card' | 'dialog';
}

export function TestSummaryMetadata({ test, latestExecution, ...props }: MetadataProps & PanelLayout & {
  latestExecution: ExecutionDetails | undefined;
}) {
  return (
    <MetadataPanel
      {...props}
      test={test}
      outcomes={test.outcomes}
      executionDetails={latestExecution}
      measuredAt={test.measuredAt}
    />
  );
}

export function ArtifactMetadata({ outcome, children, ...props }: MetadataProps & {
  outcome: ReportOutcome | undefined;
  children?: ReactNode;
}) {
  const executionDetails = outcome?.executionDetails;
  const measuredAt = executionDetails?.measurementMetadata?.measuredAt;
  return (
    <MetadataPanel
      {...props}
      variant="dialog"
      defaultExpanded
      outcomes={outcome ? [outcome] : []}
      executionDetails={executionDetails}
      measuredAt={measuredAt ? Date.parse(measuredAt) : null}
    >
      {children}
    </MetadataPanel>
  );
}

interface MetadataPanelProps extends MetadataProps, PanelLayout {
  outcomes: ReportOutcome[];
  executionDetails: ExecutionDetails | undefined;
  measuredAt: number | null;
  children?: ReactNode;
}

function MetadataPanel({
  meta, test, outcomes, executionDetails, measuredAt,
  expanded: sharedExpanded, onToggleExpanded, defaultExpanded = false, variant = 'card', actions, children,
}: MetadataPanelProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = sharedExpanded ?? localExpanded;
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const panelId = useId();
  const viewports = [...new Set(outcomes.map((outcome) => outcome.executionDetails.viewport.label))];
  const troubleshoot = pipelineTroubleshootCommands(meta, test.name, viewports);
  const testSourceHref = executionDetails?.testSourceHref ?? null;
  const sections = [
    { id: 'command', label: 'command', content: executionDetails?.measurementMetadata ? <>
      <div className="run-details__label">Latest command</div>
      <MeasurementCommand key={executionDetails.command} command={executionDetails.command} compact />
    </> : null },
    { id: 'source', label: 'test source', content: <SourceText key={testSourceHref} href={testSourceHref} /> },
    { id: 'troubleshoot', label: 'troubleshoot', content: troubleshoot.length ? <pre className="card__code">{troubleshoot.join('\n')}</pre> : null },
    { id: 'artifacts', label: 'artifact paths', content: test.viewportArtifactPaths?.length ? <pre className="card__code">{test.viewportArtifactPaths.map(({ viewport, path }) => `${viewport}: ${path}`).join('\n')}</pre> : null },
  ].filter((section) => section.content !== null);
  const active = sections.find((section) => section.id === activeSection);
  const fileAndTime = <span className="card__metadata-file-time">
    <span className="card__path" title={test.filePath}>{test.filePath}</span>
    <span className="card__measured-at">
      <span aria-hidden="true">· </span>updated {formatMeasuredAt(measuredAt)}
    </span>
  </span>;
  return (
    <div className={`card__metadata-row card__metadata-row--${variant}`}>
    <details className={`card__disclosure card__metadata card__metadata--${variant}`} open={expanded}>
      <summary onClick={(event) => {
        event.preventDefault();
        if (onToggleExpanded) onToggleExpanded();
        else setLocalExpanded((previous) => !previous);
      }}>
        <span>Metadata</span>
        {variant === 'dialog' ? fileAndTime : null}
      </summary>
      <div className="card__metadata-content">
        {variant === 'card' ? fileAndTime : null}
        <dl className="card__urls card__targets" aria-label="URLs">
          {renderPipelineTestCardUrls(meta, test, (side) => <RunCommits outcomes={outcomes} side={side} />)}
        </dl>
        {children}
        {sections.length ? <div>
          <div className="card__metadata-controls" aria-label="Metadata sections">
            {sections.map(({ id, label }) => <button
              key={id}
              id={`${panelId}-${id}`}
              type="button"
              className="card__code-toggle"
              aria-label={label}
              aria-expanded={active?.id === id}
              aria-controls={panelId}
              onClick={() => setActiveSection((previous) => previous === id ? null : id)}
            >
              {active?.id === id ? '▾' : '▸'} {label}
            </button>)}
          </div>
          <div id={panelId} className="card__metadata-panel" hidden={!active} aria-labelledby={active ? `${panelId}-${active.id}` : undefined}>
            {active?.content}
          </div>
        </div> : null}
      </div>
    </details>
    {actions ? <div className="card__actions">{actions}</div> : null}
    </div>
  );
}
