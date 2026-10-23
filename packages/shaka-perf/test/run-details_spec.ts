/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestCard } from '../report-shell/src/components/TestCard';
import { savedRunDetails, RunDetailsContent } from '../report-shell/src/components/RunDetails';
import { runDetailsFixture } from '../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../src/pipeline/report';

it.each(['compare', 'audit'] as const)('%s cards show Run details only where saved metadata exists', (pipeline) => {
  const data = runDetailsFixture(pipeline);
  const render = (index: number) => renderToStaticMarkup(createElement(TestCard, { test: data.tests[index]!, meta: data.meta, animationDelayMs: 0, visibleStages: new Set(['perf', 'audit', 'accessibility']) }));
  expect(render(0)).toContain('Run details');
  expect(render(1)).not.toContain('Run details');
});

it('preserves every mixed-run result and omits viewports without metadata', () => {
  const data = runDetailsFixture('compare');
  const groups = savedRunDetails(data.tests[0]!.outcomes);
  expect(groups.map(([label]) => label)).toEqual(['desktop']);
  expect(groups[0]![1].map(({ stage, metadata }) => [stage, metadata.runId])).toEqual([
    ['perf', '2026-10-20T20:54:53.891Z'], ['accessibility', '2026-10-20T21:00:50.722Z'],
  ]);
});

it.each(['full', 'self-contained'] as const)('retains metadata verbatim in the %s report variant', (mode) => {
  const data = runDetailsFixture('compare');
  const metadata = data.tests[0]!.outcomes[0]!.runMetadata!;
  metadata.command = 'some-artifact.json';
  metadata.numberOfMeasurements = 7;
  metadata.compareRetries = 2;
  const report = reportDataForMode(data, mode, [], '/unused', { 'some-artifact.json': 'data:application/json;base64,e30=' });
  expect(report.tests[0]!.outcomes[0]!.runMetadata).toEqual(metadata);
});

function details(outcomes = runDetailsFixture('audit').tests[0]!.outcomes) {
  return renderToStaticMarkup(createElement(RunDetailsContent, { outcomes }));
}

it('shows shared measurement facts once across results and viewports', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes;
  const first = outcomes[0]!;
  outcomes[1]!.runMetadata = { ...first.runMetadata!, measuredAt: first.runMetadata!.runId };
  outcomes[2]!.runMetadata = { ...first.runMetadata!, viewport: outcomes[2]!.viewport };
  const html = details(outcomes);
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
  expect(html.match(/http:\/\/127\.0\.0\.1:3910\//g)).toHaveLength(1);
  expect(html.match(/>1e04e038</g)).toHaveLength(1);
  expect(html.match(/4× CPU/g)).toHaveLength(1);
  expect(html).toContain('desktop');
  expect(html).toContain('phone');
  expect(html).not.toContain('<th>Measured</th>');
});

it('keeps different saved commands, targets, categories and settings associated with their runs', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes;
  const prior = outcomes[1]!.runMetadata!;
  outcomes[1]!.runMetadata = { ...prior, command: 'shaka-perf audit --filter Homepage --categories accessibility', categories: ['accessibility'], throttling: [{ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 7, network: { rttMs: 90 } }], targets: [{ ...prior.targets[0]!, url: 'http://127.0.0.1:3911/' }] };
  const html = details(outcomes);
  for (const metadata of outcomes.slice(0, 2).map((outcome) => outcome.runMetadata!)) {
    expect(html).toContain(metadata.targets[0]!.url);
    expect(html).toContain(`${metadata.throttling![0]!.cpuSlowdownMultiplier}× CPU`);
  }
  expect(html).toContain('--categories audit,accessibility');
  expect(html).toContain('shaka-perf audit --filter Homepage --categories accessibility');
  expect(html).toContain('Run 1 / audit');
  expect(html).toContain('Run 2 / accessibility');
});

it('shows distinct result times only inside the run table and retains full timestamps', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes;
  const metadata = outcomes[0]!.runMetadata!;
  outcomes[0]!.runMetadata = { ...metadata, measuredAt: '2026-10-20T20:55:02.123Z' };
  const html = details(outcomes);
  expect(html).toContain('<th>Measured</th>');
  expect(html).toContain('title="2026-10-20T20:55:02.123Z"');
  expect(html).toContain('title="2026-10-20T20:54:53.891Z"');
});

it('shows equal control and experiment throttling once', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 1);
  const metadata = outcomes[0]!.runMetadata!;
  metadata.throttling = [{ ...metadata.throttling![0]!, side: 'control' }, { ...metadata.throttling![0]!, side: 'experiment' }];
  const html = details(outcomes);
  expect(html.match(/4× CPU/g)).toHaveLength(1);
});

it.each([
  { throttling: [] },
  { throttling: [{ engine: 'Browser', method: 'legacy', cpuSlowdownMultiplier: 7, network: { rttMs: 11 } }] },
])('omits throttling when no Lighthouse settings were saved: $throttling', ({ throttling }) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(1, 2);
  outcomes[0]!.runMetadata!.throttling = throttling;
  expect(details(outcomes)).not.toContain('Throttling');
});

it('keeps commit-message body whitespace in the expandable details', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = 'Subject\n\n  Indented body\n\n';
  const html = details(outcomes);
  expect(html.match(/<summary>/g)).toHaveLength(2);
  expect(html).toContain('  Indented body\n\n</pre>');
});

it.each(['Subject', 'Subject\n\n', ''])('does not expand a commit without body content: %p', (message) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = message;
  const html = details(outcomes);
  expect(html.match(/<summary>/g)).toHaveLength(1);
  expect(html).toContain('>1e04e038<');
});

it('shows grouped Lighthouse samples and visual retries separately from result totals', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes;
  const metadata = outcomes[0]!.runMetadata!;
  Object.assign(metadata, { numberOfMeasurements: 7 });
  outcomes[1]!.stage = 'visreg';
  Object.assign(outcomes[1]!.runMetadata!, { runId: metadata.runId, compareRetries: 5, compareAttempts: 2 });
  outcomes[2]!.runMetadata = { ...metadata, viewport: outcomes[2]!.viewport };
  const html = details(outcomes);
  expect(html).toContain('3 Results');
  expect(html).not.toContain('3 measurements');
  expect(html.match(/7 LH samples per side/g)).toHaveLength(1);
  expect(html).toContain('2 visual tries');
  expect(html).not.toContain('Up to');
});

it('keeps differing saved sampling counts scoped to their measurement runs', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 2);
  Object.assign(outcomes[0]!.runMetadata!, { numberOfMeasurements: 7 });
  Object.assign(outcomes[1]!.runMetadata!, { numberOfMeasurements: 1 });
  outcomes[1]!.stage = 'perf';
  const html = details(outcomes);
  expect(html).toContain('7 LH samples per side');
  expect(html).toContain('1 LH sample per side');
  expect(html).toContain('Run 1 / perf');
  expect(html).toContain('Run 2 / perf');
});

it.each([undefined, 0])('omits absent sampling fields and unused visual retries: %p', (compareRetries) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  Object.assign(outcomes[0]!.runMetadata!, { compareRetries });
  const html = details(outcomes);
  expect(html).toContain('1 Result');
  expect(html).not.toContain('<h3>Sampling</h3>');
});

// Counts saved by other Lighthouse stages remain available as metadata, but
// only statistical perf sampling belongs in this modal.
it.each(['perf-low-noise', 'perf-warmup', 'audit'])('omits sample counts for %s', (stage) => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.stage = stage;
  outcomes[0]!.runMetadata!.numberOfMeasurements = 1;
  expect(details(outcomes)).not.toContain('<h3>Sampling</h3>');
});

it.each([undefined, 1])('does not show a configured retry budget when actual tries are %p', (compareAttempts) => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.stage = 'visreg';
  Object.assign(outcomes[0]!.runMetadata!, { compareRetries: 5, compareAttempts });
  expect(details(outcomes)).not.toContain('<h3>Sampling</h3>');
});
