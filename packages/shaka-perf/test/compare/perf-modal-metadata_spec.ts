/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementSettings } from '../../report-shell/src/components/MeasurementSettings';
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
  return renderToStaticMarkup(createElement(MeasurementSettings, { outcomes }));
}

it.each(['perf', 'perf-low-noise', 'audit'])('shows saved measurement counts for %s', (stage) => {
  const outcome = savedOutcome();
  outcome.stage = stage;
  outcome.runMetadata!.numberOfMeasurements = stage === 'perf' ? 7 : 1;
  const html = render([outcome]);
  expect(html).toContain('<dt>number of measurements</dt>');
  expect(html).toContain(`<dd>${stage === 'perf' ? 7 : 1} per side</dd>`);
  expect(html).toContain('4× CPU');
  expect(html).toContain('150 ms RTT');
  expect(html).not.toContain('Sampling');
  expect(html).not.toContain('Run 1');
});

it('uses only the selected low-noise outcome when perf used a different count and throttling', () => {
  const statistical = savedOutcome();
  statistical.runMetadata!.numberOfMeasurements = 7;
  const lowNoise: ReportOutcome = {
    ...statistical,
    stage: 'perf-low-noise',
    runMetadata: {
      ...statistical.runMetadata!,
      numberOfMeasurements: 1,
      throttling: [{ engine: 'Lighthouse', method: 'devtools', cpuSlowdownMultiplier: 2,
        network: { requestLatencyMs: 90, downloadThroughputKbps: 800 } }],
    },
  };
  const html = render([lowNoise]);
  expect(html).toContain('<dd>1 per side</dd>');
  expect(html).toContain('2× CPU');
  expect(html).toContain('90 ms latency');
  expect(html).toContain('800 kbps down');
  expect(html).not.toContain('7 per side');
  expect(html).not.toContain('4× CPU');
});

it('shows equal settings once across both sides and differently ordered network fields', () => {
  const outcome = savedOutcome();
  outcome.runMetadata!.numberOfMeasurements = 7;
  outcome.runMetadata!.throttling = [
    { engine: 'Lighthouse', method: 'simulate', side: 'control', cpuSlowdownMultiplier: 4,
      network: { rttMs: 150, throughputKbps: 800 } },
    { engine: 'Lighthouse', method: 'simulate', side: 'experiment', cpuSlowdownMultiplier: 4,
      network: { throughputKbps: 800, rttMs: 150 } },
  ];
  const html = render([outcome, outcome]);
  expect(html.match(/4× CPU/g)).toHaveLength(1);
  expect(html.match(/7 per side/g)).toHaveLength(1);
});

it('labels one-target measurements without a per-side qualifier', () => {
  const outcome = savedOutcome(true);
  outcome.runMetadata!.numberOfMeasurements = 1;
  expect(render([outcome])).toContain('<dd>1</dd>');
  expect(render([outcome])).not.toContain('per side');
});

it('identifies each side when saved throttling settings differ', () => {
  const outcome = savedOutcome();
  outcome.runMetadata!.throttling = [
    { engine: 'Lighthouse', method: 'simulate', side: 'control', cpuSlowdownMultiplier: 4,
      network: { rttMs: 150 } },
    { engine: 'Lighthouse', method: 'simulate', side: 'experiment', cpuSlowdownMultiplier: 7,
      network: { rttMs: 90 } },
  ];
  const html = render([outcome]);
  expect(html).toContain('<dt>throttling · control</dt>');
  expect(html).toContain('<dt>throttling · experiment</dt>');
  expect(html).toContain('4× CPU · 150 ms RTT');
  expect(html).toContain('7× CPU · 90 ms RTT');
});

it('keeps unlabelled historical audit settings unlabelled', () => {
  const outcome = savedOutcome(true);
  outcome.runMetadata!.throttling!.push({ engine: 'Lighthouse', method: 'provided', network: {} });
  const html = render([outcome]);
  expect(html.match(/<dt>throttling<\/dt>/g)).toHaveLength(2);
  expect(html).not.toContain('throttling ·');
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
