/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestCard } from '../report-shell/src/components/TestCard';
import { TargetCommits } from '../report-shell/src/components/TargetCommits';
import { runDetailsFixture } from '../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../src/pipeline/report';

it.each(['compare', 'audit'] as const)('%s cards have no redundant metadata-details dialog', (pipeline) => {
  const data = runDetailsFixture(pipeline);
  const html = renderToStaticMarkup(createElement(TestCard, { test: data.tests[0]!, meta: data.meta, animationDelayMs: 0, visibleStages: new Set(['perf', 'audit', 'accessibility']) }));
  expect(html).not.toContain('Metadata details');
  expect(html).toContain('Metadata');
  expect(html).toContain('logs');
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

it('keeps commit-message body whitespace in the expandable details', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = 'Subject\n\n  Indented body\n\n';
  const html = renderToStaticMarkup(createElement(TargetCommits, { outcomes }));
  expect(html.match(/<summary>/g)).toHaveLength(1);
  expect(html).toContain('  Indented body\n\n</pre>');
});

it.each(['Subject', 'Subject\n\n', ''])('does not expand a commit without body content: %p', (message) => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 1);
  outcomes[0]!.runMetadata!.targets[0]!.commit!.message = message;
  const html = renderToStaticMarkup(createElement(TargetCommits, { outcomes }));
  expect(html).not.toContain('<summary>');
  expect(html).toContain('>1e04e038<');
});
