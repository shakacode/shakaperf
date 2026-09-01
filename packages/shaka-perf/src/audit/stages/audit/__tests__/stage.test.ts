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
  it('links the performance profile and network activity the run captured', () => {
    const html = render({
      metrics: [],
      performanceProfileHref: 'unit/artifacts/experiment_performance_profile.summary.txt',
      networkActivityHref: 'unit/artifacts/experiment_network_activity.txt',
    });

    expect(html).toContain('performance profile');
    expect(html).toContain('network activity');
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
      { measurement, viewport: DESKTOP_VIEWPORT },
    ])),
  );
}
