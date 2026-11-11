/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { performanceMetadataFields } from '../../src/compare/stages/perf/metadata-fields';
import { ArtifactMetadataFields } from '../../src/pipeline/stage-report-components';

const throttling = { engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4,
  network: { rttMs: 150, throughputKbps: 1638.4 } };

it.each([1, 7])('renders saved count %s as plain shared metadata', numberOfMeasurements => {
  const fields = performanceMetadataFields({ numberOfMeasurements, perSide: true, throttling: [throttling] });
  expect(fields['number of measurements']).toBe(`${numberOfMeasurements} per side`);
  expect(fields.throttling).toContain('4× CPU');
  expect(fields.throttling).toContain('150 ms RTT');
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, { fields }))).toContain('<dt>number of measurements</dt>');
});

it('does not infer unavailable counts or settings', () => {
  expect(performanceMetadataFields()).toEqual({});
  expect(performanceMetadataFields({ throttling: [throttling] })['number of measurements']).toBeUndefined();
});

it('does not label one-target measurements per side', () => {
  expect(performanceMetadataFields({ numberOfMeasurements: 1 })['number of measurements']).toBe('1');
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

it('labels differing saved settings by measured side', () => {
  const fields = performanceMetadataFields({ throttling: [
    { ...throttling, side: 'control' },
    { ...throttling, side: 'experiment', cpuSlowdownMultiplier: 2 },
  ] });
  expect(fields['throttling · control']).toContain('4× CPU');
  expect(fields['throttling · experiment']).toContain('2× CPU');
});
