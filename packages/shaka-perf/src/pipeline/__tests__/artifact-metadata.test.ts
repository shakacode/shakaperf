/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { executionFixture } from './fixtures/execution';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactMetadataFields } from '../../report-ui/metadata/ArtifactMetadataFields';

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
