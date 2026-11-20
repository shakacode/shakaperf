/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { AuditStage, type AuditResult } from '../stage';

describe('AuditStage self-contained report stripping', () => {
  it('removes every heavyweight artifact the card links to', () => {
    expect(new AuditStage({}).selfContainedReportStrip).toEqual({
      lighthouseHref: true,
      lighthouseThumbHref: true,
      performanceProfileHref: true,
      networkActivityHref: true,
    });
  });
});

describe('AuditStage artifact card', () => {
  it('shows visible-image coverage, findings, and reasons on the viewport card', () => {
    const image = {
      label: 'img', src: '/hero.jpg', fit: 'cover', boxWidth: 300, boxHeight: 300,
      naturalWidth: 200, naturalHeight: 200, devicePixelRatio: 1,
    };
    const html = render({
      metrics: [],
      imageResolution: {
        undersized: 1, oversized: 0, unknown: 1, failOnUndersized: false,
        images: [
          { ...image, status: 'undersized', sourceWidth: 200, sourceHeight: 200, requiredWidth: 300, requiredHeight: 300 },
          { ...image, src: '/icon.svg', status: 'unknown', reason: 'Vector image.' },
          { ...image, src: '/sufficient.png', status: 'sufficient' },
        ],
      },
    });
    expect(html).toContain('3 visible · 2 checked · 1 undersized · 0 oversized · 1 unknown');
    expect(html).toContain('/hero.jpg');
    expect(html).toContain('200 × 200 px');
    expect(html).toContain('300 × 300 px');
    expect(html).toContain('/icon.svg');
    expect(html).toContain('Vector image.');
    expect(html).not.toContain('/sufficient.png');
  });

  it('links the performance profile and network activity the run captured', () => {
    const html = render({
      metrics: [],
      performanceProfileHref: 'unit/artifacts/experiment_performance_profile.summary.txt',
      networkActivityHref: 'unit/artifacts/experiment_network_activity.txt',
    });

    expect(html).toContain('performance profile');
    expect(html).toContain('network activity');
  });

  it('shows the speed result alongside the image collection error', () => {
    const html = render({
      metrics: [{ label: 'LCP', value: 1200, unit: 'ms', display: '1.2 s', group: 'vitals' }],
      imageResolution: { status: 'unavailable', reason: 'Image collector timed out.', failOnUndersized: true },
    });
    expect(html).toContain('1.2 s');
    expect(html).toContain('Image check unavailable. Image collector timed out.');
    expect(html).not.toContain('0 visible');
  });

  it('renders a card for a run that captured artifacts but no metrics', () => {
    const html = render({
      metrics: [],
      networkActivityHref: 'unit/artifacts/experiment_network_activity.txt',
    });

    expect(html).toContain('network activity');
    expect(html).not.toContain('performance profile');
  });

  it('omits the links row when the run captured neither file', () => {
    const html = render({
      metrics: [{
        label: 'LCP',
        value: 1200,
        unit: 'ms',
        display: '1.2 s',
        group: 'vitals',
      }],
    });

    expect(html).not.toContain('artifact-links');
  });
});

function render(measurement: AuditResult): string {
  return renderToStaticMarkup(
    createElement('div', null, new AuditStage({}).renderArtifacts([
      { measurement, viewport: DESKTOP_VIEWPORT, latestRun: true },
    ])),
  );
}
