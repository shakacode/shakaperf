/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import { pipelineStagesForReport, renderPersistedStageArtifacts, renderPersistedStageHeadingBadge } from '../../../src/pipeline/pipeline-artifacts';
import { ScreenshotPreview } from '../../../src/pipeline/screenshot-preview';
import { ArtifactScope, DetailedArtifactDialog, OldRunChip, StageRunChipsProvider } from '../../../src/pipeline/stage-report-components';
import type { ReportMeta, ReportOutcome } from '../types';
import { ReportSection } from '../../../src/pipeline/report-section';

// V8 stack traces start with `<ErrorName>: <message>` — `Error`,
// `TypeError`, `RangeError`, custom subclasses. We strip that prefix
// before rendering the stack because the same message is already shown
// above in bold; the duplication is noise.
const STACK_HEAD_PATTERN = /^[A-Z][A-Za-z]*: [^\n]*\n+/;

function OutcomeError({ outcome, latestRun }: { outcome: ReportOutcome; latestRun: boolean }) {
  const message = outcome.error?.message?.trim();
  const displayMessage = message && message.length > 0 ? message : 'stage failed';
  const stack = (outcome.error?.stack ?? '').replace(STACK_HEAD_PATTERN, '');
  // Full reports carry paths while self-contained reports carry data URIs.
  // Detect the media kind from either representation.
  const media = outcome.failure?.media;
  const isVideo = media != null && (
    /^data:video\//i.test(media) ||
    /\.(?:mp4|webm|og[gv])(?:[?#]|$)/i.test(media)
  );
  // Headline with the last test annotation reached (e.g. "Fill email") so the
  // banner names the in-flight test step; fall back to the stage name for
  // failures with no annotation (non-test stages, or a throw before the first
  // `annotate`).
  const heading = outcome.error?.lastAnnotation ?? outcome.stage;
  return (
    <div className="slot-error" role="alert">
      <div className="slot-error__body">
        <p className="slot-error__message">
          <span className="slot-error__label">
            Error during "{heading}" · {outcome.viewport.label}:
            <OldRunChip latestRun={latestRun} />
          </span>{' '}
          <span className="slot-error__detail">{displayMessage}</span>
        </p>
        {media && isVideo ? (
          // The video replays the run up to the failure — for interaction
          // failures it shows what actually happened, which a still can't.
          // `controls` so it can be scrubbed; not autoplaying so a grid of
          // failures doesn't all start at once.
          <video
            className="slot-error__video"
            src={media}
            controls
            preload="metadata"
            playsInline
          />
        ) : null}
        {media && !isVideo ? (
          <ArtifactScope outcome={outcome}>
            <DetailedArtifactDialog
              className="slot-error__screenshot"
              image
              href={media}
              label="failure screenshot"
              title={`${outcome.viewport.label} ${outcome.stage} failure screenshot`}
            >
              <ScreenshotPreview src={media} alt="failure screenshot" />
            </DetailedArtifactDialog>
          </ArtifactScope>
        ) : null}
        {stack ? (
          <details open>
            <summary>stack</summary>
            <pre className="error-log error-log--stack">{stack}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The section one stage's outcomes render, or null when they render nothing —
 * a stage whose measurements produce no artifact (an accessibility comparison
 * that found no differences) is as absent as one that never ran. Null here
 * means the stage is absent for every purpose: section counts, the sections
 * filter, and the card itself.
 */
export function stageSection(
  meta: ReportMeta,
  outcomes: readonly ReportOutcome[],
  latestRunId?: string | null,
  testOutcomes: readonly ReportOutcome[] = outcomes,
): { errorOutcomes: ReportOutcome[]; artifact: ReactNode; badge: ReactNode } | null {
  const first = outcomes[0];
  if (!first) return null;

  const errorOutcomes = outcomes.filter((outcome) => outcome.kind === 'error');
  const measurements = outcomes.flatMap((outcome) => (
    outcome.kind !== 'ok' || outcome.measurement == null
      ? []
      : [{
        measurement: outcome.measurement,
        outcome,
        viewport: outcome.viewport,
        latestRun: latestRunId == null || outcome.runId === latestRunId,
      }]
  ));
  const artifact = measurements.length > 0
    ? renderPersistedStageArtifacts(meta.pipelineName, meta.pipelineConfig, first.stage, measurements, { outcomes: testOutcomes })
    : null;

  if (errorOutcomes.length === 0 && artifact == null) return null;
  const badge = renderPersistedStageHeadingBadge(meta.pipelineName, meta.pipelineConfig, first.stage, measurements);
  return { errorOutcomes, artifact, badge };
}

export function OutcomeSlot({
  meta,
  outcomes,
  testOutcomes,
  latestRunId,
  showRunChips,
}: {
  meta: ReportMeta;
  outcomes: readonly ReportOutcome[];
  testOutcomes: readonly ReportOutcome[];
  latestRunId?: string | null;
  showRunChips?: boolean;
}) {
  const first = outcomes[0];
  const section = stageSection(meta, outcomes, latestRunId, testOutcomes);
  if (!first || !section) return null;
  const { errorOutcomes, artifact, badge } = section;
  const title = pipelineStagesForReport(meta.pipelineName, meta.pipelineConfig)
    .find((stage) => stage.name === first.stage)!.label;

  return (
    <section className="outcome-slot" data-stage={first.stage} tabIndex={-1}>
      <StageRunChipsProvider value={showRunChips === true}>
        <ReportSection sectionKey={first.stage} title={title} badge={badge}>
          {errorOutcomes.map((outcome, index) => (
            <OutcomeError
              key={`error-${outcome.viewport.label}-${index}`}
              outcome={outcome}
              latestRun={latestRunId == null || outcome.runId === latestRunId}
            />
          ))}
          {artifact ? <div className="stage-artifact">{artifact}</div> : null}
        </ReportSection>
      </StageRunChipsProvider>
    </section>
  );
}
