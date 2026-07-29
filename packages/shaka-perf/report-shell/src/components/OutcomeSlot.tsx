/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { renderPersistedStageArtifacts } from '../../../src/pipeline/pipeline-artifacts';
import type { ReportMeta, ReportOutcome } from '../types';

// V8 stack traces start with `<ErrorName>: <message>` — `Error`,
// `TypeError`, `RangeError`, custom subclasses. We strip that prefix
// before rendering the stack because the same message is already shown
// above in bold; the duplication is noise.
const STACK_HEAD_PATTERN = /^[A-Z][A-Za-z]*: [^\n]*\n+/;

function OutcomeError({ outcome }: { outcome: ReportOutcome }) {
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
          <a
            className="slot-error__screenshot"
            href={media}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={media} alt="failure screenshot" />
          </a>
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

export function OutcomeSlot({
  meta,
  outcomes,
}: {
  meta: ReportMeta;
  outcomes: readonly ReportOutcome[];
}) {
  const first = outcomes[0];
  if (!first) return null;

  const okOutcomes = outcomes.filter((outcome) => outcome.kind === 'ok');
  const errorOutcomes = outcomes.filter((outcome) => outcome.kind === 'error');
  const measurements = okOutcomes.flatMap((outcome) => (
    outcome.measurement == null
      ? []
      : [{ measurement: outcome.measurement, viewport: outcome.viewport }]
  ));

  const artifact = measurements.length > 0
    ? renderPersistedStageArtifacts(meta.pipelineName, meta.pipelineConfig, first.stage, measurements)
    : null;

  if (errorOutcomes.length === 0 && artifact == null) {
    return null;
  }

  return (
    <section className="outcome-slot" data-stage={first.stage} tabIndex={-1}>
      {errorOutcomes.map((outcome, index) => (
        <OutcomeError key={`error-${outcome.viewport.label}-${index}`} outcome={outcome} />
      ))}
      {artifact ? <div className="stage-artifact">{artifact}</div> : null}
    </section>
  );
}
