/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { performanceMetadataFields } from '../../src/compare/stages/perf/metadata-fields';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';
import { reportDataForMode } from '../../src/pipeline/report';
import { ArtifactMetadataFields } from '../../src/pipeline/stage-report-components';

const throttling = { engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4,
  network: { rttMs: 150, throughputKbps: 1638.4 } };

it.each([1, 7])('renders saved count %s as plain shared metadata', numberOfMeasurements => {
  const fields = performanceMetadataFields({ numberOfMeasurements, measurementSideCount: 2, throttling: [throttling] });
  expect(fields['number of measurements']).toBe(`${numberOfMeasurements} per side${numberOfMeasurements === 1 ? ' (1 sample below)' : ''}`);
  expect(fields.throttling).toContain('4× CPU');
  expect(fields.throttling).toContain('150 ms RTT');
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, { fields }))).toContain('<dt>number of measurements</dt>');
});

it('does not infer unavailable counts or settings', () => {
  expect(performanceMetadataFields()).toEqual({});
  expect(performanceMetadataFields({ throttling: [throttling] })['number of measurements']).toBeUndefined();
});

it('does not label one-target measurements per side', () => {
  expect(performanceMetadataFields({ numberOfMeasurements: 1 })['number of measurements']).toBe('1 (1 sample below)');
});

it('deduplicates equal settings with differently ordered network fields', () => {
  const fields = performanceMetadataFields({ throttling: [throttling, { ...throttling, network: { throughputKbps: 1638.4, rttMs: 150 } }] });
  expect(fields.throttling.match(/4× CPU/g)).toHaveLength(1);
});

it('does not claim emulated CPU for provided throttling', () => {
  expect(performanceMetadataFields({ throttling: [{ ...throttling, method: 'provided', network: {} }] }).throttling)
    .toBe('Lighthouse · provided · No network emulation');
});

it('escapes saved strings through the shared metadata component', () => {
  const fields = performanceMetadataFields({ throttling: [{ ...throttling, method: '<script>unsafe()</script>' }] });
  const html = renderToStaticMarkup(createElement(ArtifactMetadataFields, { fields }));
  expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});

it('labels a saved single sample without reading another stage', () => {
  expect(performanceMetadataFields({ numberOfMeasurements: 1, measurementSideCount: 2 }))
    .toMatchObject({ 'number of measurements': '1 per side (1 sample below)' });
});

it.each(['full', 'self-contained'] as const)('preserves selected execution settings without mutating input in %s reports', mode => {
  const data = runDetailsFixture('compare');
  const outcome = data.tests[0]!.outcomes[0]!;
  outcome.executionDetails = { ...outcome.executionDetails, numberOfMeasurements: 7, measurementSideCount: 2,
    throttling: [{ ...throttling, method: 'saved-settings.json' }] };
  const before = JSON.stringify(data);
  const rendered = reportDataForMode(data, mode, [], '/unused', { 'saved-settings.json': 'data:application/json;base64,e30=' });
  expect(rendered.tests[0]!.outcomes[0]!.executionDetails).toEqual(outcome.executionDetails);
  expect(JSON.stringify(data)).toBe(before);
});
