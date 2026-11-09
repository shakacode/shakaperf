/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildMeasurementSettings } from '../../src/pipeline/measurement-settings-model';
import { MeasurementSettings } from '../../src/pipeline/measurement-settings';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { ReportOutcome } from '../../src/pipeline/report';

function savedOutcome(singleTarget = false): ReportOutcome {
  return {
    kind: 'ok', stage: 'perf', measurement: {}, viewport: DESKTOP_VIEWPORT,
    runMetadata: {
      command: 'shaka-perf compare', runId: '2026-10-20T20:54:53.891Z',
      measuredAt: '2026-10-20T20:54:53.891Z', stages: ['perf'], categories: ['perf'],
      viewport: DESKTOP_VIEWPORT, testSourcePath: null,
      targets: (singleTarget ? ['experiment'] as const : ['control', 'experiment'] as const)
        .map((side) => ({ side, url: `http://${side}.test`, commit: null })),
      throttling: [{ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4,
        network: { rttMs: 150, throughputKbps: 1638.4 } }],
    },
  };
}

function render(outcomes: readonly ReportOutcome[]) {
  return renderToStaticMarkup(createElement(MeasurementSettings, { settings: buildMeasurementSettings(outcomes) }));
}

it('labels one-target measurements without a per-side qualifier', () => {
  const outcome = savedOutcome(true);
  outcome.runMetadata!.numberOfMeasurements = 1;
  expect(render([outcome])).toContain('<dd>1</dd>');
  expect(render([outcome])).not.toContain('per side');
});

it('does not claim emulated CPU or network settings for provided throttling', () => {
  const outcome = savedOutcome(true);
  outcome.runMetadata!.throttling = [{ engine: 'Lighthouse', method: 'provided',
    cpuSlowdownMultiplier: 4, network: {} }];
  const html = render([outcome]);
  expect(html).toContain('Lighthouse · provided · No network emulation');
  expect(html).not.toContain('4× CPU');
});

it('leaves unavailable historical settings absent', () => {
  const outcome = savedOutcome();
  delete outcome.runMetadata;
  expect(render([outcome])).toBe('');
});
