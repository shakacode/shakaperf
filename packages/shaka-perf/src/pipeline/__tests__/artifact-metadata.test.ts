/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { executionFixture } from './fixtures/execution';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactMetadataFields } from '../../report-ui/ArtifactMetadataFields';
import { visualComparisonFields } from '../../compare/stages/visreg';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { VisregArtifact } from '../../compare/stages/visreg';

it('escapes values and keeps stage fields separate from execution details', () => {
  const html = renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    ...executionFixture({
      stageMetadata: { '<selector>': '<script>alert(1)</script>', 'error retries': 'stage value' },
      taskRetries: 2, taskRetryLimit: 3, recoveredAfterRetries: true,
    }),
  }));
  expect(html).toContain('&lt;selector&gt;');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('2/3 · recovered');
  expect(html).toContain('stage value');
});

it('omits unused execution rows and preserves unknown recovery counts', () => {
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    ...executionFixture({ taskRetries: 0 }),
  }))).toBe('');
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    ...executionFixture({ recoveredAfterRetries: true }),
  }))).toContain('?/? · recovered');
});

it('formats selector counts without borrowing execution counts', () => {
  const artifact: VisregArtifact = {
    selector: '#checkout', controlImage: '', experimentImage: '', diffImage: null,
    misMatchPercentage: 0, diffPixels: 0, threshold: 0, diffBbox: null, savedByRetries: false,
    visualComparisonCount: 1, visualComparisonLimit: 5,
  };
  const fields = (value: VisregArtifact) => visualComparisonFields([value], DESKTOP_VIEWPORT);
  const multiple = visualComparisonFields([artifact, { ...artifact, selector: '#pay', visualComparisonCount: 4 }], DESKTOP_VIEWPORT);
  expect(multiple['visual comparisons · #checkout']).toBe('1/5');
  expect(multiple['visual comparisons · #pay']).toBe('4/5');
  expect(fields(artifact)['visual comparisons']).toBe('1/5');
  expect(fields({ ...artifact, visualComparisonLimit: undefined })['visual comparisons']).toBe('1');
  expect(fields({ ...artifact, visualComparisonCount: 3, savedByRetries: true })['visual comparisons']).toBe('3/5 · matched on retry');
  expect(fields({ ...artifact, visualComparisonCount: undefined, savedByRetries: true })['visual comparisons']).toBeUndefined();
  expect(fields({ ...artifact, visualComparisonCount: undefined })['visual comparisons']).toBeUndefined();
});
