/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactMetadataFields } from '../stage-report-components';
import { DESKTOP_VIEWPORT } from 'shaka-shared';

it('escapes values and keeps stage fields separate from execution details', () => {
  const html = renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    fields: { '<selector>': '<script>alert(1)</script>', 'error retries': 'stage value' },
    executionDetails: { runId: 'fixture-run', testSourceHref: null, viewport: DESKTOP_VIEWPORT, taskRetries: 2, taskRetryLimit: 3, recoveredAfterRetries: true },
  }));
  expect(html).toContain('&lt;selector&gt;');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('2/3 · recovered');
  expect(html).toContain('stage value');
});

it('omits unused execution rows and preserves unknown recovery counts', () => {
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    executionDetails: { runId: 'fixture-run', testSourceHref: null, viewport: DESKTOP_VIEWPORT, recoveredAfterRetries: false, taskRetries: 0 },
  }))).toBe('');
  expect(renderToStaticMarkup(createElement(ArtifactMetadataFields, {
    executionDetails: { runId: 'fixture-run', testSourceHref: null, viewport: DESKTOP_VIEWPORT, recoveredAfterRetries: true },
  }))).toContain('?/? · recovered');
});

