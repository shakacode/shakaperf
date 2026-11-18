/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { accessibilityDialogFields } from '../../src/audit/stages/accessibility/report-dialog';
import { ArtifactMetadataFields } from '../../src/pipeline/stage-report-components';

it.each([
  'https://experiment.test',
  'https://experiment.test/after-checkout',
  'https://experiment.test/?search=<script>alert("test")</script>',
])('preserves and escapes the measured scanned URL: %s', url => {
  const fields = accessibilityDialogFields({
    viewportLabel: 'saved', viewport: DESKTOP_VIEWPORT, url, violations: [],
  }, 0, DESKTOP_VIEWPORT);
  expect(fields['scanned URL']).toBe(url);
  const html = renderToStaticMarkup(createElement(ArtifactMetadataFields, { fields }));
  expect(html).toContain('scanned URL');
  expect(html).not.toContain('<script>');
});

it('does not invent viewport dimensions without execution details', () => {
  const fields = accessibilityDialogFields({
    viewportLabel: 'saved', viewport: DESKTOP_VIEWPORT, url: 'https://experiment.test', violations: [],
  }, 0);
  expect(fields.viewport).toBe('saved');
});
