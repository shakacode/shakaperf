/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestCard } from '../report-shell/src/components/TestCard';
import { savedRunDetails, RunDetailsContent, RunCommits } from '../report-shell/src/components/RunDetails';
import { runDetailsFixture } from '../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../src/pipeline/report';

it.each(['compare', 'audit'] as const)('%s cards show Metadata details only where saved metadata exists', (pipeline) => {
  const data = runDetailsFixture(pipeline);
  const render = (index: number) => renderToStaticMarkup(createElement(TestCard, { test: data.tests[index]!, meta: data.meta, animationDelayMs: 0, visibleStages: new Set(['perf', 'audit', 'accessibility']) }));
  expect(render(0)).toContain('Metadata details');
  expect(render(1)).not.toContain('Metadata details');
});

it('preserves every mixed-run result and omits viewports without metadata', () => {
  const data = runDetailsFixture('compare');
  const groups = savedRunDetails(data.tests[0]!.outcomes);
  expect(groups.map(([label]) => label)).toEqual(['desktop']);
  expect(groups[0]![1].map(({ stage, executionDetails }) => [stage, executionDetails.runId])).toEqual([
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
  outcomes[1]!.runMetadata = { ...first.runMetadata!, measuredAt: first.executionDetails.runId };
  outcomes[2]!.runMetadata = { ...first.runMetadata! };
  outcomes[1]!.executionDetails = { ...outcomes[1]!.executionDetails, runId: first.executionDetails.runId, throttling: first.executionDetails.throttling };
  outcomes[2]!.executionDetails = { ...outcomes[2]!.executionDetails, runId: first.executionDetails.runId, throttling: first.executionDetails.throttling };
  const html = details(outcomes);
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('http://127.0.0.1:3910/');
  expect(html).not.toContain('>1e04e038<');
  expect(html.match(/4× CPU/g)).toHaveLength(1);
  expect(html).toContain('desktop');
  expect(html).toContain('phone');
  expect(html).not.toContain('<th>Measured</th>');
});

it('keeps different throttling settings associated with their runs', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes;
  const prior = outcomes[1]!.runMetadata!;
  outcomes[1]!.runMetadata = { ...prior, command: 'shaka-perf audit --filter Homepage --categories accessibility', categories: ['accessibility'], throttling: [{ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 7, network: { rttMs: 90 } }], targets: [{ ...prior.targets[0]!, url: 'http://127.0.0.1:3911/' }] };
  outcomes[1]!.executionDetails = { ...outcomes[1]!.executionDetails, throttling: outcomes[1]!.runMetadata!.throttling };
  const html = details(outcomes);
  for (const metadata of outcomes.slice(0, 2).map((outcome) => outcome.executionDetails)) {
    expect(html).toContain(`${metadata.throttling![0]!.cpuSlowdownMultiplier}× CPU`);
  }
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
  outcomes[0]!.executionDetails = { ...outcomes[0]!.executionDetails, throttling: [{ ...outcomes[0]!.executionDetails.throttling![0]!, side: 'control' }, { ...outcomes[0]!.executionDetails.throttling![0]!, side: 'experiment' }] };
  const html = details(outcomes);
  expect(html.match(/4× CPU/g)).toHaveLength(1);
});

it.each([
  { throttling: [] },
  { throttling: [{ engine: 'Browser', method: 'legacy', cpuSlowdownMultiplier: 7, network: { rttMs: 11 } }] },
])('omits throttling when no Lighthouse settings were saved: $throttling', ({ throttling }) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(1, 2);
  outcomes[0]!.executionDetails = { ...outcomes[0]!.executionDetails, throttling };
  expect(details(outcomes)).not.toContain('Throttling');
});

it('keeps commit-message body whitespace in the expandable details', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = 'Subject\n\n  Indented body\n\n';
  const html = renderToStaticMarkup(createElement(RunCommits, { outcomes }));
  expect(html.match(/<summary>/g)).toHaveLength(1);
  expect(html).toContain('  Indented body\n\n</pre>');
});

it.each(['Subject', 'Subject\n\n', ''])('does not expand a commit without body content: %p', (message) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = message;
  const html = renderToStaticMarkup(createElement(RunCommits, { outcomes }));
  expect(html).not.toContain('<summary>');
  expect(html).toContain('>1e04e038<');
});

it('keeps grouped Lighthouse samples and result totals without visual retry details', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes;
  const metadata = outcomes[0]!.runMetadata!;
  Object.assign(outcomes[0]!.executionDetails, { numberOfMeasurements: 7 });
  outcomes[1]!.stage = 'visreg';
  Object.assign(outcomes[1]!.runMetadata!, { compareRetries: 5, compareAttempts: 2 });
  outcomes[2]!.runMetadata = { ...metadata };
  outcomes[1]!.executionDetails = { ...outcomes[1]!.executionDetails, runId: outcomes[0]!.executionDetails.runId };
  outcomes[2]!.executionDetails = { ...outcomes[2]!.executionDetails, runId: outcomes[0]!.executionDetails.runId };
  const html = details(outcomes);
  expect(html).toContain('3 Results');
  expect(html).not.toContain('3 measurements');
  expect(html.match(/7 LH samples per side/g)).toHaveLength(1);
  expect(html).not.toContain('2 visual attempts');
  expect(html).not.toContain('Up to');
});

it('keeps differing saved sampling counts scoped to their measurement runs', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 2);
  Object.assign(outcomes[0]!.executionDetails, { numberOfMeasurements: 7 });
  Object.assign(outcomes[1]!.executionDetails, { numberOfMeasurements: 1 });
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
  Object.assign(outcomes[0]!.executionDetails, { numberOfMeasurements: 1 });
  expect(details(outcomes)).not.toContain('<h3>Sampling</h3>');
});

it.each(['compare', 'audit'] as const)('%s details omit sections available in card and visual metadata', (pipeline) => {
  const outcomes = runDetailsFixture(pipeline).tests[0]!.outcomes;
  outcomes[0]!.executionDetails = { ...outcomes[0]!.executionDetails, recoveredAfterRetries: true, taskRetries: 1, taskRetryLimit: 2 };
  Object.assign(outcomes[0]!.runMetadata!, { compareAttempts: 4, compareRetries: 2 });
  const html = details(outcomes);
  for (const heading of ['Applications', 'Measurement command', 'Categories', 'Viewports', 'Retries and attempts']) {
    expect(html).not.toContain(`<h3>${heading}</h3>`);
  }
  expect(html).not.toContain('1 task retry');
  expect(html).not.toContain('4 visual attempts');
  expect(html).not.toContain('1e04e038');
  expect(html).not.toContain('http://127.0.0.1:3910/');
  expect(html).not.toContain('<textarea');
  expect(html).toContain('Throttling');
  expect(html).toContain('Runs');
});
