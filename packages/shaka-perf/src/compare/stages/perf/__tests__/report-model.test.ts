/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { PHONE_VIEWPORT } from 'shaka-shared';
import type { ReportOutcome } from '../../../../pipeline/report';
import type { PerfArtifact } from '../../perf';
import { buildPerfReportEntries } from '../report-model';

function outcome(stage: string, count: number): ReportOutcome {
  return {
    kind: 'ok', stage, runId: 'saved-run', measurement: {}, viewport: PHONE_VIEWPORT,
    runMetadata: {
      runId: 'saved-run', command: 'saved command', measuredAt: '2026-11-08T00:00:00Z',
      stages: [stage], categories: ['perf'], viewport: PHONE_VIEWPORT, testSourcePath: null,
      numberOfMeasurements: count,
      targets: ['control', 'experiment'].map((side) => ({ side: side as 'control' | 'experiment', url: `https://${side}.test`, commit: null })),
      throttling: [{ engine: 'Lighthouse', method: count === 1 ? 'devtools' : 'simulate', network: {} }],
    },
  };
}

function project(artifact: ReportOutcome, outcomes: readonly ReportOutcome[], stage = 'perf') {
  return buildPerfReportEntries([{
    measurement: artifact.measurement as PerfArtifact, outcome: artifact,
    viewport: artifact.viewport, latestRun: true,
  }], stage, { outcomes })[0]!.settings;
}

it('joins the saved count while preserving the artifact sample and throttling', () => {
  const artifact = outcome('perf-low-noise', 1);
  const statistical = outcome('perf', 10);
  const settings = project(artifact, [statistical, outcome('another-stage', 13)]);
  expect(settings.counts).toEqual([{ count: 10, perSide: true }]);
  expect(settings.sampleCount).toBe(1);
  expect(settings.throttling?.method).toBe('devtools');
});

it.each(['label', 'width', 'height', 'formFactor', 'deviceScaleFactor', 'userAgent'] as const)(
  'does not join another saved viewport with different %s', (field) => {
    const statistical = outcome('perf', 13);
    statistical.runMetadata!.viewport = { ...PHONE_VIEWPORT, [field]: field === 'formFactor' ? 'desktop' :
      typeof PHONE_VIEWPORT[field] === 'number' ? 999 : 'other' };
    expect(project(outcome('perf-low-noise', 1), [statistical]).counts).toEqual([]);
  },
);

it('matches the saved viewport rather than a later report projection', () => {
  const artifact = outcome('perf-low-noise', 1);
  artifact.viewport = { ...PHONE_VIEWPORT, width: 999 };
  expect(project(artifact, [outcome('perf', 10)]).counts).toEqual([{ count: 10, perSide: true }]);
});

it('does not join a stale run, an ambiguous result, or a failed result', () => {
  const artifact = outcome('perf-low-noise', 1);
  const stale = outcome('perf', 13);
  stale.runMetadata!.runId = 'another-run';
  const statistical = outcome('perf', 10);
  expect(project(artifact, [stale]).counts).toEqual([]);
  expect(project(artifact, [statistical, outcome('perf', 10)]).counts).toEqual([]);
  expect(project(artifact, [{ ...statistical, kind: 'error' }]).counts).toEqual([]);
});

it('does not join historical outcomes when the artifact run identity is unknown', () => {
  const artifact = outcome('perf-low-noise', 1);
  artifact.runMetadata!.runId = '';
  delete artifact.runId;
  const historical = outcome('perf', 13);
  historical.runMetadata!.runId = '';
  delete historical.runId;
  expect(project(artifact, [historical]).counts).toEqual([]);
});

it('does not infer a missing saved viewport from current report configuration', () => {
  const artifact = outcome('perf-low-noise', 1);
  delete artifact.runMetadata;
  expect(project(artifact, [outcome('perf', 10)]).counts).toEqual([]);
});

it.each(['formFactor', 'deviceScaleFactor'] as const)('rejects incomplete saved viewport identity without %s', (field) => {
  const artifact = outcome('perf-low-noise', 1);
  const statistical = outcome('perf', 10);
  artifact.runMetadata!.viewport = { ...PHONE_VIEWPORT, [field]: undefined } as unknown as typeof PHONE_VIEWPORT;
  statistical.runMetadata!.viewport = artifact.runMetadata!.viewport;
  expect(project(artifact, [statistical]).counts).toEqual([]);
});

it('uses its own saved count when the stage owns both statistics and artifacts', () => {
  expect(project(outcome('perf', 7), []).counts).toEqual([{ count: 7, perSide: true }]);
});

it.each(['label', 'runId'] as const)('rejects malformed numeric %s identities', (field) => {
  const artifact = outcome('perf-low-noise', 1);
  const statistical = outcome('perf', 10);
  for (const saved of [artifact, statistical]) {
    if (field === 'label') saved.runMetadata!.viewport = { ...PHONE_VIEWPORT, label: 123 as unknown as string };
    else saved.runMetadata!.runId = 123 as unknown as string;
  }
  expect(project(artifact, [statistical]).counts).toEqual([]);
});
