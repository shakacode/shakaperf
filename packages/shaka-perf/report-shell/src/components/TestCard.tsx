/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useState } from 'react';
import type { ChipDescriptor, ReportMeta, ReportOutcome, TestResult } from '../types';
import { Pill } from './Pill';
import { OutcomeSlot } from './OutcomeSlot';
import { AnsiLog, firstElapsedSeconds } from './AnsiLog';
import { Dialog, StageArtifactProvider, TestMeta } from '../../../src/pipeline/stage-report-components';
import {
  pipelineTroubleshootCommands,
  renderPipelineTestCardUrls,
} from '../../../src/pipeline/pipeline-artifacts';

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

interface LogEntry {
  label: string;
  body: string;
  /**
   * Sort key for chronological ordering. The runner stamps every log line
   * with a `<X.Ys>` elapsed tag; we pull the first one as the section's
   * start time. Skipped/empty bodies fall back to `+Infinity` so they
   * always sink to the bottom rather than steal the top slot with a 0.
   */
  sortKey: number;
}

function logsForTest(test: TestResult, visibleStages: ReadonlySet<string>): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const outcome of test.outcomes) {
    if (!visibleStages.has(outcome.stage)) continue;
    const titleSuffix = ` · ${outcome.viewport.label}`;
    if (outcome.logs) {
      const sortKey = firstElapsedSeconds(outcome.logs);
      logs.push({
        label: `${outcome.stage}${titleSuffix}`,
        body: outcome.logs,
        sortKey: sortKey ?? Number.POSITIVE_INFINITY,
      });
    }
    if (outcome.kind === 'skipped') {
      logs.push({
        label: `${outcome.stage} skipped${titleSuffix}`,
        body: outcome.reason ?? 'skipped',
        sortKey: Number.POSITIVE_INFINITY,
      });
    }
  }
  logs.sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label));
  return logs;
}

function outcomeGroups(test: TestResult, visibleStages: ReadonlySet<string>): ReportOutcome[][] {
  const groups: ReportOutcome[][] = [];
  const byStage = new Map<string, ReportOutcome[]>();
  for (const outcome of test.outcomes) {
    if (!visibleStages.has(outcome.stage)) continue;
    let group = byStage.get(outcome.stage);
    if (!group) {
      group = [];
      byStage.set(outcome.stage, group);
      groups.push(group);
    }
    group.push(outcome);
  }
  return groups;
}

/**
 * How to re-run this test on its own, beside its source — the card names the
 * failure, this names the way back into it. One line per viewport it measured.
 */
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

function compareChips(a: ChipDescriptor, b: ChipDescriptor): number {
  return a.sortingWeight - b.sortingWeight ||
    a.tag.localeCompare(b.tag) ||
    a.text.localeCompare(b.text) ||
    a.color.localeCompare(b.color);
}

export function TestCard({
  test,
  meta,
  animationDelayMs,
  runLabel,
  dimmed,
  visibleStages,
}: {
  test: TestResult;
  meta: ReportMeta;
  animationDelayMs: number;
  runLabel?: 'latest' | 'old' | null;
  visibleStages: ReadonlySet<string>;
  /**
   * True when the test doesn't match the active chip filter. The card stays
   * in the grid (the filter is a focus tool, not a hide) but greys out and
   * desaturates so the focused cards visually pop.
   */
  dimmed?: boolean;
}) {
  const [codeOpen, setCodeOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const logs = logsForTest(test, visibleStages);
  const groups = outcomeGroups(test, visibleStages);
  const chips = [...test.chips].sort(compareChips);

  return (
    <article
      className="card"
      data-report-test-id={test.id}
      data-chip-color={chips[0]?.color ?? 'gray'}
      data-dimmed={dimmed ? 'true' : undefined}
      tabIndex={-1}
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="card__head">
        <div>
          <h3 className="card__title">{test.name}</h3>
          <div className="card__path">{test.filePath}</div>
          <div className="card__measured-at" title="mtime of the freshest per-test artifact on disk">
            updated {formatMeasuredAt(test.measuredAt)}
          </div>
        </div>
        <div className="card__pills">
          {runLabel ? (
            <span className={`pill pill--${runLabel === 'latest' ? 'blue' : 'gray'}`}>
              <span className="pill__label">{runLabel} run</span>
            </span>
          ) : null}
          {chips.map((chip) => (
            <Pill key={`${chip.tag}:${chip.text}`} chip={chip} />
          ))}
          {logs.length > 0 ? (
            <button
              type="button"
              className="card__logs-button"
              onClick={() => setLogsOpen(true)}
              aria-haspopup="dialog"
            >
              logs
            </button>
          ) : null}
        </div>
      </div>

      <dl className="card__urls">
        {renderPipelineTestCardUrls(meta, test)}
      </dl>

      <div className="card__body">
        <StageArtifactProvider test={{ ...test, pipelineName: meta.pipelineName, pipelineConfig: meta.pipelineConfig }}>
          {groups.map((outcomes, index) => (
            <OutcomeSlot
              key={`${outcomes[0]?.stage ?? 'stage'}-${index}`}
              meta={meta}
              outcomes={outcomes}
            />
          ))}
        </StageArtifactProvider>

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

      <Dialog
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        title={<span className="ui-dialog__title-text">measurement logs</span>}
        meta={<TestMeta test={{ ...test, pipelineName: meta.pipelineName, pipelineConfig: meta.pipelineConfig }} />}
      >
        <div className="card-logs">
          {logs.map((log, index) => (
            <section key={`${log.label}-${index}`} className="card-logs__section">
              <div className="card-logs__label">{log.label}</div>
              <AnsiLog
                text={log.body}
                className="error-log"
                errorClassName="error-log__line--error"
              />
            </section>
          ))}
        </div>
      </Dialog>
    </article>
  );
}
