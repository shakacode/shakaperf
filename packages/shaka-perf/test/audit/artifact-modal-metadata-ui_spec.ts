/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { AccessibilityDialogMeta } from '../../src/audit/stages/accessibility/report-dialog';
import type { AccessibilityScan } from '../../src/audit/stages/accessibility/types';
import { StageArtifactProvider, type StageArtifactTestMeta } from '../../src/pipeline/stage-report-components';

const test: StageArtifactTestMeta = {
  name: 'Checkout', filePath: 'ab-tests/checkout.abtest.ts', startingPath: '/',
  controlUrl: 'https://control.test', experimentUrl: 'https://experiment.test',
};

function renderScannedUrl(url: string, context?: StageArtifactTestMeta): string {
  const scan: AccessibilityScan = {
    viewportLabel: DESKTOP_VIEWPORT.label, viewport: DESKTOP_VIEWPORT, url, violations: [],
  };
  const fields = createElement(AccessibilityDialogMeta, { scan, hotspotCount: 0 });
  return renderToStaticMarkup(context ? createElement(StageArtifactProvider, {
    test: context, renderMetadata: () => null, children: fields,
  }) : fields);
}

it('preserves the scanned URL after navigation changes the page', () => {
  const scannedUrl = 'https://experiment.test/after-checkout';
  const html = renderScannedUrl(scannedUrl, test);
  expect(html).toContain('scanned URL');
  expect(html).toContain(scannedUrl);
});

it('omits the scanned URL when common metadata already shows it', () => {
  expect(renderScannedUrl(test.experimentUrl, test)).not.toContain(test.experimentUrl);
});

it('preserves the scanned URL without common test context', () => {
  expect(renderScannedUrl(test.experimentUrl)).toContain(test.experimentUrl);
});
