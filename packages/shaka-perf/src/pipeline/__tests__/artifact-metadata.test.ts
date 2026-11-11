/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactMetadataFields, RecoveryBadges } from '../stage-report-components';
import { visualComparisonFields } from '../../compare/stages/visreg/report';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { VisregArtifact } from '../../compare/stages/visreg';

it('escapes values and keeps stage fields separate from execution details', () => {
  const html = renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    fields: { '<selector>': '<script>alert(1)</script>', 'error retries': 'stage value' },
    executionDetails: { runId: 'fixture-run', testSourcePath: null, viewport: DESKTOP_VIEWPORT, taskRetries: 2, taskRetryLimit: 3, recoveredAfterRetries: true },
  }));
  expect(html).toContain('&lt;selector&gt;');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('2/3 · recovered');
  expect(html).toContain('stage value');
});

it('omits unused execution rows and preserves unknown recovery counts', () => {
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    executionDetails: { runId: 'fixture-run', testSourcePath: null, viewport: DESKTOP_VIEWPORT, recoveredAfterRetries: false, taskRetries: 0 },
  }))).toBe('');
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    executionDetails: { runId: 'fixture-run', testSourcePath: null, viewport: DESKTOP_VIEWPORT, recoveredAfterRetries: true },
  }))).toContain('?/? · recovered');
});

it.each([
  [false, false, []], [true, false, ['flaky']],
  [false, true, ['unstable']], [true, true, ['flaky', 'unstable']],
] as const)('renders recovery badges from facts (%s, %s)', (taskRecovered, comparisonRecovered, labels) => {
  const html = renderToStaticMarkup(createElement(RecoveryBadges, { taskRecovered, comparisonRecovered }));
  expect(html.includes('>flaky<')).toBe(labels.some(label => label === 'flaky'));
  expect(html.includes('>unstable<')).toBe(labels.some(label => label === 'unstable'));
});

it('formats selector counts without borrowing execution counts', () => {
  const artifact: VisregArtifact = {
    selector: '#checkout', controlImage: '', experimentImage: '', diffImage: null,
    misMatchPercentage: 0, diffPixels: 0, threshold: 0, diffBbox: null, savedByRetries: false,
    compareAttempts: 1, compareRetries: 4,
  };
  const fields = (value: VisregArtifact) => visualComparisonFields({
    artifact: value, viewportLabel: DESKTOP_VIEWPORT.label,
    entry: { measurement: [value],  latestRun: true,
      executionDetails: { viewport: DESKTOP_VIEWPORT, testSourcePath: null, runId: 'fixture-run', taskRetries: 3, taskRetryLimit: 5, recoveredAfterRetries: true } },
  });
  expect(fields(artifact)['visual comparisons']).toBeUndefined();
  expect(fields({ ...artifact, compareAttempts: 3, savedByRetries: true })['visual comparisons']).toBe('3/5 · matched on retry');
  expect(fields({ ...artifact, compareAttempts: undefined, savedByRetries: true })['visual comparisons']).toContain('count unavailable');
  expect(fields({ ...artifact, compareAttempts: undefined })['visual comparisons']).toBeUndefined();
});
