/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { executionFixture } from '../../../../pipeline/__tests__/fixtures/execution';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

  it('links the per-image resolution list', () => {
    const html = render({
      metrics: [{ label: 'undersized-images', value: 1, unit: '', display: '1', group: 'diagnostics' }],
      imageResolutionHref: 'unit/artifacts/experiment_image_resolution.html',
    });

    expect(html).toContain('image resolution');
  });
});

describe('AuditStage machine-readable summary', () => {
  it('lists every metric by name, for scripts that read report.json', () => {
    expect(new AuditStage({}).machineReadableSummary({
      metrics: [
        { label: 'LCP', value: 1200, unit: 'ms', display: '1.2 s', group: 'vitals' },
        { label: 'undersized-images', value: 2, unit: '', display: '2', group: 'diagnostics' },
      ],
    })).toEqual({ metrics: { LCP: 1200, 'undersized-images': 2 } });
  });
});

function render(measurement: AuditResult): string {
  return renderToStaticMarkup(
    createElement('div', null, new AuditStage({}).renderArtifacts([
      { measurement,  ...executionFixture(), latestRun: true },
    ])),
  );
}
