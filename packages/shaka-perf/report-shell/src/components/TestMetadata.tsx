/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useState, type ReactNode } from 'react';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import { ExecutionSource } from './ExecutionSource';
import type { ReportMeta, TestResult } from '../types';
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

export function TestMetadata({ meta, test, expanded: sharedExpanded, onToggleExpanded, defaultExpanded = false, children, executionDetails }: {
  executionDetails?: ExecutionDetails;
  meta: ReportMeta;
  test: TestResult;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  defaultExpanded?: boolean;
  children?: ReactNode;
}) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = sharedExpanded ?? localExpanded;
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const panelId = useId();
  const viewports = [...new Set(test.outcomes.map((outcome) => outcome.executionDetails.viewport.label))];
  const troubleshoot = pipelineTroubleshootCommands(meta, test.name, viewports);
  // Outcome order follows stages/viewports, not measurement chronology.
  const latest = test.outcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : [])
    .sort((a, b) => (Date.parse(b.measuredAt) || 0) - (Date.parse(a.measuredAt) || 0))[0];
  const sections = [
    { id: 'command', label: 'command', content: latest ? <>
      <div className="run-details__label">Latest command</div>
      <MeasurementCommand key={latest.command} command={latest.command} compact />
    </> : null },
    { id: 'source', label: 'test source', content: <ExecutionSource outcomes={test.outcomes} executionDetails={executionDetails} /> },
    { id: 'troubleshoot', label: 'troubleshoot', content: troubleshoot.length ? <pre className="card__code">{troubleshoot.join('\n')}</pre> : null },
    { id: 'artifacts', label: 'artifact paths', content: test.viewportArtifactPaths?.length ? <pre className="card__code">{test.viewportArtifactPaths.map(({ viewport, path }) => `${viewport}: ${path}`).join('\n')}</pre> : null },
  ].filter((section) => section.content !== null);
  const active = sections.find((section) => section.id === activeSection);
  return (
    <details className="card__disclosure card__metadata" open={expanded}>
      <summary onClick={(event) => {
        event.preventDefault();
        if (onToggleExpanded) onToggleExpanded();
        else setLocalExpanded((previous) => !previous);
      }}>Metadata</summary>
      <div className="card__metadata-content">
        <div>
          <div className="card__path">{test.filePath}</div>
          <div className="card__measured-at" title="mtime of the freshest per-test artifact on disk">
            updated {formatMeasuredAt(test.measuredAt)}
          </div>
        </div>
        {children}
        <dl className="card__urls card__targets" aria-label="URLs">
          {renderPipelineTestCardUrls(meta, test, (side) => <RunCommits outcomes={test.outcomes} side={side} />)}
        </dl>
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
  );
}
