/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { performanceMetadataFields } from '../../src/stage/performance-metadata';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../../src/pipeline/report';
import { MetadataRows } from '../../src/report-ui/metadata/ArtifactMetadataFields';

const throttling = { engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4,
  network: { rttMs: 150, throughputKbps: 1638.4 } };

it.each([1, 7])('renders saved count %s as plain shared metadata', numberOfMeasurements => {
  const fields = performanceMetadataFields({ numberOfMeasurements, measuredSideCount: 2, throttling });
  expect(fields['number of measurements']).toBe(`${numberOfMeasurements} per side`);
  expect(fields.throttling).toContain('4× CPU');
  expect(fields.throttling).toContain('150 ms RTT');
  expect(renderToStaticMarkup(createElement(MetadataRows, { fields }))).toContain('<dt>number of measurements</dt>');
});

it('does not label one-target measurements per side', () => {
  expect(performanceMetadataFields({ numberOfMeasurements: 1, measuredSideCount: 1 })['number of measurements']).toBe('1');
});

it('does not claim emulated CPU for provided throttling', () => {
  expect(performanceMetadataFields({ numberOfMeasurements: 1, measuredSideCount: 2, throttling: { ...throttling, method: 'provided', network: {} } }).throttling)
    .toBe('Lighthouse · provided · No network emulation');
});

it('escapes saved strings through the shared metadata component', () => {
  const fields = performanceMetadataFields({ numberOfMeasurements: 1, measuredSideCount: 2, throttling: { ...throttling, method: '<script>unsafe()</script>' } });
  const html = renderToStaticMarkup(createElement(MetadataRows, { fields }));
  expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});

it.each(['full', 'self-contained'] as const)('preserves selected execution settings without mutating input in %s reports', mode => {
  const data = runDetailsFixture('compare');
  const outcome = data.tests[0]!.outcomes[0]!;
  outcome.executionDetails = { ...outcome.executionDetails, measurementMetadata: { ...outcome.executionDetails.measurementMetadata!, numberOfMeasurements: 7,
    throttling: { ...throttling, method: 'saved-settings.json' } } };
  const before = JSON.stringify(data);
  const rendered = reportDataForMode(data, mode, [], '/unused', { 'saved-settings.json': 'data:application/json;base64,e30=' });
  expect(rendered.tests[0]!.outcomes[0]!.executionDetails).toEqual(outcome.executionDetails);
  expect(JSON.stringify(data)).toBe(before);
});
