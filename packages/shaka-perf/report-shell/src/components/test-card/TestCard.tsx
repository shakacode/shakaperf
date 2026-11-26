/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { ChipDescriptor, ReportMeta, ReportOutcome, TestResult } from '../../types';
import { TestCardProvider } from '../../../../src/report-ui/metadata/TestCardProvider';
import { pipelineTestTargets } from '../../../../src/pipeline/pipeline-artifacts';
import { TestSummaryMetadata } from './TestSummaryMetadata';
import { ReviewedCheckbox, useReviewed } from './ReviewedCheckbox';
import { Pill } from '../Pill';
import { OutcomeSlot } from './OutcomeSlot';
import { TestLogsButton } from './TestLogsButton';

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
  const { reviewed, updateReviewed } = useReviewed(meta, test);
  const groups = outcomeGroups(test, visibleStages);
  const chips = [...test.chips].sort(compareChips);
  const mixedRuns = new Set(test.outcomes.map((outcome) => outcome.executionDetails.runId === latestRunId)).size > 1;

  const testCardData = {
    meta,
    test: {
      name: test.name,
      filePath: test.filePath,
      viewportArtifactPaths: test.viewportArtifactPaths,
    },
    targets: pipelineTestTargets(meta, test),
  };

  return (
    <TestCardProvider value={testCardData}>
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
          <ReviewedCheckbox reviewed={reviewed} onChange={updateReviewed} />
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

          <div className="card__metadata-row card__metadata-row--card">
            <TestSummaryMetadata test={test} expanded={metadataExpanded} onToggleExpanded={onToggleMetadata} />
            <TestLogsButton test={test} visibleStages={visibleStages} />
          </div>

          {reviewed ? null : (
            <div className="card__body">
              {groups.map((outcomes, index) => (
                <OutcomeSlot
                  key={`${outcomes[0]?.stage ?? 'stage'}-${index}`}
                  meta={meta}
                  outcomes={outcomes}
                  latestRunId={latestRunId}
                  showRunChips={showViewportRunChips && mixedRuns}
                />
              ))}
            </div>
          )}
        </div>
      </article>
    </TestCardProvider>
  );
}
