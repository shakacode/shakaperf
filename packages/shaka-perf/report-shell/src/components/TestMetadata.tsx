/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState } from 'react';
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

function TroubleshootCommands({ meta, test }: { meta: ReportMeta; test: TestResult }) {
  const [open, setOpen] = useState(false);
  const viewports = [...new Set(test.outcomes.map((outcome) => outcome.viewport.label))];
  const commands = pipelineTroubleshootCommands(meta, test.name, viewports);
  if (commands.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        className="card__code-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? '▾ troubleshoot' : '▸ troubleshoot'}
      </button>
      {open ? <pre className="card__code">{commands.join('\n')}</pre> : null}
    </div>
  );
}

export function TestMetadata({ meta, test }: { meta: ReportMeta; test: TestResult }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  // Outcome order follows stages/viewports, not measurement chronology.
  const latest = test.outcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : [])
    .sort((a, b) => (Date.parse(b.measuredAt) || Date.parse(b.runId) || 0) - (Date.parse(a.measuredAt) || Date.parse(a.runId) || 0))[0];
  return (
    <details className="card__metadata">
      <summary>Metadata</summary>
      <div className="card__metadata-content">
        <div>
          <div className="card__path">{test.filePath}</div>
          <div className="card__measured-at" title="mtime of the freshest per-test artifact on disk">
            updated {formatMeasuredAt(test.measuredAt)}
          </div>
        </div>
        <dl className="card__urls">{renderPipelineTestCardUrls(meta, test)}</dl>
        <RunCommits outcomes={test.outcomes} />
        <div>
          <div className="run-details__label">Latest command</div>
          {latest ? <MeasurementCommand key={latest.command} command={latest.command} compact /> : <span className="run-details__unavailable">Latest command unavailable</span>}
        </div>
        {test.code ? (
          <div>
            <button
              type="button"
              className="card__code-toggle"
              onClick={() => setCodeOpen((prev) => !prev)}
              aria-expanded={codeOpen}
            >
              {codeOpen ? '▾ test source' : '▸ test source'}
            </button>
            {codeOpen ? <pre className="card__code">{test.code}</pre> : null}
          </div>
        ) : null}

        <TroubleshootCommands meta={meta} test={test} />

        {test.viewportArtifactPaths && test.viewportArtifactPaths.length > 0 ? (
          <div>
            <button
              type="button"
              className="card__code-toggle"
              onClick={() => setArtifactsOpen((prev) => !prev)}
              aria-expanded={artifactsOpen}
            >
              {artifactsOpen ? '▾ artifact paths' : '▸ artifact paths'}
            </button>
            {artifactsOpen ? (
              <pre className="card__code">
                {test.viewportArtifactPaths
                  .map(({ viewport, path }) => `${viewport}: ${path}`)
                  .join('\n')}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
