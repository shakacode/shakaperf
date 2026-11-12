/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { ChipDescriptor, ReportMeta, ReportOutcome, TestResult } from '../types';
import { RunDetails } from './RunDetails';
import { TestMetadata } from './TestMetadata';
import { Pill } from './Pill';
import { OutcomeSlot } from './OutcomeSlot';
import { AnsiLog, firstElapsedSeconds } from './AnsiLog';
import { Dialog, ArtifactMetadataFields, StageArtifactProvider, TestMeta } from '../../../src/pipeline/stage-report-components';

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
    const titleSuffix = ` · ${outcome.executionDetails.viewport.label}`;
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

// Tie review to the saved results, not the report that happens to display them.
// Include every stage/viewport: a partial rerun can replace just one outcome.
export function reviewedKey(meta: ReportMeta, test: TestResult): string {
  const outcomes = test.outcomes.map((outcome) => JSON.stringify([
    outcome.stage,
    outcome.executionDetails.viewport.label,
    outcome.executionDetails.viewport.width,
    outcome.executionDetails.viewport.height,
    outcome.executionDetails.runId,
  ])).sort();
  return `shaka-perf:reviewed:v2:${JSON.stringify([
    meta.cwd, meta.pipelineName, test.id, outcomes,
  ])}`;
}

function readReviewed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeReviewed(key: string, reviewed: boolean): void {
  try {
    if (reviewed) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Storage blocked (private window, file:// quirks): the mark lasts the session.
  }
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
  oldRun,
  latestRunId,
  showViewportRunChips = true,
  dimmed,
  visibleStages,
  expanded: sharedExpanded,
  onToggleExpanded,
  tagsExpanded: sharedTagsExpanded,
  onToggleTags,
  metadataExpanded,
  onToggleMetadata,
}: {
  test: TestResult;
  meta: ReportMeta;
  animationDelayMs: number;
  oldRun?: boolean;
  latestRunId?: string | null;
  showViewportRunChips?: boolean;
  visibleStages: ReadonlySet<string>;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  tagsExpanded?: boolean;
  onToggleTags?: () => void;
  metadataExpanded?: boolean;
  onToggleMetadata?: () => void;
  /**
   * True when the test doesn't match the active chip filter. The card stays
   * in the grid (the filter is a focus tool, not a hide) but greys out and
   * desaturates so the focused cards visually pop.
   */
  dimmed?: boolean;
}) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = sharedExpanded ?? localExpanded;
  const [localTagsExpanded, setLocalTagsExpanded] = useState(true);
  const tagsExpanded = sharedTagsExpanded ?? localTagsExpanded;
  const contentId = useId();
  const titleRef = useRef<HTMLButtonElement>(null);
  const scrollPending = useRef(false);

  useEffect(() => {
    if (!expanded || !scrollPending.current) return;
    scrollPending.current = false;
    const frame = requestAnimationFrame(() => {
      const title = titleRef.current;
      if (!title || document.activeElement !== title) return;
      title.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const storageKey = reviewedKey(meta, test);
  const [reviewed, setReviewed] = useState(() => readReviewed(storageKey));
  const logs = logsForTest(test, visibleStages);
  const groups = outcomeGroups(test, visibleStages);
  const chips = [...test.chips].sort(compareChips);
  const mixedRuns = new Set(test.outcomes.map((outcome) => outcome.executionDetails.runId === latestRunId)).size > 1;

  return (
    <article
      className="card"
      data-report-test-id={test.id}
      data-chip-color={chips[0]?.color ?? 'gray'}
      data-dimmed={dimmed ? 'true' : undefined}
      data-reviewed={reviewed ? 'true' : undefined}
      data-collapsed={expanded ? undefined : 'true'}
      tabIndex={-1}
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="card__head">
        <div>
          <h3 className="card__title">
            <button
              type="button"
              className="card__title-toggle"
              ref={titleRef}
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => {
                titleRef.current?.focus({ preventScroll: true });
                scrollPending.current = !expanded;
                if (onToggleExpanded) onToggleExpanded();
                else setLocalExpanded((previous) => !previous);
              }}
            >
              <span className="card__title-caret" aria-hidden="true" />
              <span>{test.name}</span>
            </button>
          </h3>
        </div>
        <div className="card__pills">
          <label className="card__reviewed">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => {
                const checked = e.target.checked;
                writeReviewed(storageKey, checked);
                setReviewed(checked);
              }}
            />
            reviewed
          </label>
        </div>
      </div>

      <div id={contentId} hidden={!expanded}>
        <details className="card__disclosure card__tags" open={tagsExpanded}>
          <summary onClick={(event) => {
            event.preventDefault();
            if (onToggleTags) onToggleTags();
            else setLocalTagsExpanded((previous) => !previous);
          }}>Tags</summary>
          <div className="card__tag-list">
            {oldRun ? (
              <span className="pill pill--gray">
                <span className="pill__label">old run</span>
              </span>
            ) : null}
            {chips.map((chip) => (
              <Pill key={`${chip.tag}:${chip.text}`} chip={chip} />
            ))}
          </div>
        </details>

        <div className="card__metadata-row">
          <TestMetadata meta={meta} test={test} expanded={metadataExpanded} onToggleExpanded={onToggleMetadata} />
          <div className="card__actions">
            <RunDetails outcomes={test.outcomes} />
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

        {reviewed ? null : (
          <div className="card__body">
            <StageArtifactProvider
              test={{ ...test, pipelineName: meta.pipelineName, pipelineConfig: meta.pipelineConfig }}
              renderMetadata={(details) => (
                <TestMetadata meta={meta} test={test} executionDetails={details.executionDetails} defaultExpanded>
                  <ArtifactMetadataFields {...details} />
                  {logs.length > 0 ? <button type="button" className="card__logs-button" onClick={() => setLogsOpen(true)} aria-haspopup="dialog">logs</button> : null}
                </TestMetadata>
              )}
            >
              {groups.map((outcomes, index) => (
                <OutcomeSlot
                  key={`${outcomes[0]?.stage ?? 'stage'}-${index}`}
                  meta={meta}
                  outcomes={outcomes}
                  latestRunId={latestRunId}
                  showRunChips={showViewportRunChips && mixedRuns}
                />
              ))}
            </StageArtifactProvider>
          </div>
        )}
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
