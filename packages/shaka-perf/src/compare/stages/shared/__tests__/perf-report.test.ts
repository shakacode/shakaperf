/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import type { PerfArtifact } from '../../perf';
import { PerfArtifactView } from '../perf-report';

function perfWithMetrics(metrics: PerfArtifact['metrics']): PerfArtifact {
  return { metrics };
}

function metric(label: string, group: 'vitals' | 'diagnostics'): NonNullable<PerfArtifact['metrics']>[number] {
  return {
    label,
    group,
    controlValue: 100,
    experimentValue: 120,
    deltaValue: 20,
    controlDisplay: '100ms',
    experimentDisplay: '120ms',
    deltaDisplay: '+20ms',
    percentDisplay: '+20%',
    deltaPercent: 20,
    pValue: 0.01,
    direction: 'regression',
  };
}

describe('PerfArtifactView', () => {
  it('labels each viewport metric group and no-difference note clearly', () => {
    const html = renderToStaticMarkup(createElement(PerfArtifactView, {
      title: 'Performance',
      measurements: [
        {
          executionDetails: { viewport: PHONE_VIEWPORT, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false }, latestRun: true,
          measurement: perfWithMetrics([metric('LCP', 'vitals'), metric('js', 'diagnostics')]),

        },
        {
          executionDetails: { viewport: DESKTOP_VIEWPORT, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false }, latestRun: true,
          measurement: perfWithMetrics([{ ...metric('FCP', 'vitals'), direction: 'none' }]),

        },
      ],
    }));

    expect(html).toContain('aria-label="phone performance"');
    expect(html).toContain('aria-label="desktop performance"');
    expect(html).toContain('<h5 class="report-heading report-section__title">phone performance</h5>');
    expect(html).toContain('<h5 class="report-heading report-section__title">desktop performance</h5>');
    expect(html).toContain('<h6 class="report-heading stage-section__head">vitals</h6>');
    expect(html).toContain('<h6 class="report-heading stage-section__head">diagnostics</h6>');
    expect(html).toContain('<span class="stage-note__label">desktop:</span>');
    expect(html).toContain('No statistically significant differences.');
  });

  it('renders an attachment-only timeline preview without the stripped detail artifact', () => {
    const previewHref = 'data:image/avif;base64,cHJldmlldw==';
    const html = renderToStaticMarkup(createElement(PerfArtifactView, {
      title: 'Performance',
      measurements: [{
        executionDetails: { viewport: DESKTOP_VIEWPORT, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false }, latestRun: true,
        measurement: { timelinePreviewHref: previewHref },

      }],
    }));

    expect(html).toContain('aria-label="desktop performance"');
    expect(html).toContain(`src="${previewHref}"`);
    expect(html).toContain('alt="timeline preview"');
  });
});
