/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetCommits } from '../report-shell/src/components/TargetCommits';
import { runDetailsFixture } from '../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../src/pipeline/report';

it.each(['full', 'self-contained'] as const)('retains metadata verbatim in the %s report variant', (mode) => {
  const data = runDetailsFixture('compare');
  const metadata = data.tests[0]!.outcomes[0]!.runMetadata!;
  metadata.command = 'some-artifact.json';
  const selected = data.tests[0]!.outcomes[0]!;
  selected.executionDetails = { ...selected.executionDetails, numberOfMeasurements: 7, taskRetries: 2 };
  const executionDetails = structuredClone(selected.executionDetails);
  const report = reportDataForMode(data, mode, [], '/unused', { 'some-artifact.json': 'data:application/json;base64,e30=' });
  expect(report.tests[0]!.outcomes[0]!.runMetadata).toEqual(metadata);
  expect(report.tests[0]!.outcomes[0]!.executionDetails).toEqual(executionDetails);
  expect(selected.executionDetails).toEqual(executionDetails);
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

it('labels distinct commits with their saved execution run and viewport', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 2);
  for (const [index, outcome] of outcomes.entries()) {
    outcome.executionDetails = {
      ...outcome.executionDetails,
      runId: `saved-run-${index}`,
      viewport: { ...outcome.executionDetails.viewport, label: `saved-viewport-${index}` },
    };
    // Legacy duplicate fields must not override the selected execution.
    Object.assign(outcome.runMetadata!, { runId: 'wrong-run', viewport: { label: 'wrong-viewport' } });
    outcome.runMetadata!.targets[0]!.commit!.message = `Saved commit ${index}`;
  }
  const html = renderToStaticMarkup(createElement(TargetCommits, { outcomes }));
  expect(html).toContain('Run 1 / audit · saved-viewport-0');
  expect(html).toContain('Run 2 / accessibility · saved-viewport-1');
  expect(html).not.toContain('wrong-viewport');
});

it('keeps each side and escaped commit text separate', () => {
  const outcomes = runDetailsFixture('compare').tests[0]!.outcomes.slice(0, 1);
  const targets = outcomes[0]!.runMetadata!.targets;
  targets[0]!.commit!.message = '<script>control</script>\n\n  control body\n';
  targets[1]!.commit!.message = 'Experiment commit';
  const html = renderToStaticMarkup(createElement(TargetCommits, { outcomes, side: 'control' }));
  expect(html).toContain('&lt;script&gt;control&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('Experiment commit');
  expect(html).toContain('  control body\n</pre>');
});

it('preserves unavailable commits without borrowing another result', () => {
  const outcomes = runDetailsFixture('audit').tests[0]!.outcomes.slice(0, 2);
  outcomes[0]!.runMetadata!.targets[0]!.commit = null;
  const html = renderToStaticMarkup(createElement(TargetCommits, { outcomes: outcomes.slice(0, 1) }));
  expect(html).toContain('Commit unavailable');
  expect(html).not.toContain('1e04e038');
});
