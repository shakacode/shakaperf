/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { accessibilityStageMetadata } from '../../src/audit/stages/accessibility/stage';
import { MetadataRows } from '../../src/report-ui/ArtifactMetadataFields';

it.each([
  'https://experiment.test',
  'https://experiment.test/after-checkout',
  'https://experiment.test/?search=<script>alert("test")</script>',
])('preserves and escapes the measured scanned URL: %s', url => {
  const fields = accessibilityStageMetadata({
    viewportLabel: 'saved', viewport: DESKTOP_VIEWPORT, url, violations: [],
  }, DESKTOP_VIEWPORT);
  expect(fields['scanned URL']).toBe(url);
  expect(fields.viewport).toBe(`desktop ${DESKTOP_VIEWPORT.width} × ${DESKTOP_VIEWPORT.height}`);
  const html = renderToStaticMarkup(createElement(MetadataRows, { fields }));
  expect(html).toContain('scanned URL');
  expect(html).not.toContain('<script>');
});
