/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { OutcomeSlot } from '../../report-shell/src/components/OutcomeSlot';
import type { ReportMeta, ReportOutcome } from '../../src/pipeline/report';

const META = {
  pipelineName: 'compare',
  pipelineConfig: {},
} as ReportMeta;

function renderFailureMedia(media: string): string {
  const outcome = {
    kind: 'error',
    stage: 'visreg',
    viewport: DESKTOP_VIEWPORT,
    error: { message: 'boom' },
    failure: { media },
  } as unknown as ReportOutcome;
  return renderToStaticMarkup(createElement(OutcomeSlot, {
    meta: META,
    outcomes: [outcome],
  }));
}

describe('OutcomeSlot failure media', () => {
  it.each([
    'checkout/artifacts/failure.mp4',
    'data:video/mp4;base64,dmlkZW8=',
  ])('renders video media from %s', (media) => {
    const html = renderFailureMedia(media);

    expect(html).toContain('<video');
    expect(html).not.toContain('failure screenshot');
  });

  it.each([
    'checkout/artifacts/failure.png',
    'data:image/png;base64,aW1hZ2U=',
  ])('renders image media from %s', (media) => {
    const html = renderFailureMedia(media);

    expect(html).toContain('failure screenshot');
    expect(html).not.toContain('<video');
  });
});
