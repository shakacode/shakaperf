/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactScope } from '../../../../pipeline/artifact-store';
import { readPerfArtifact } from '../artifacts';

function metric(
  phaseName: string,
  estimatorDelta: string,
  isSignificant = true,
  controlValue = 100,
  experimentValue = 100,
  confidenceInterval = ['0ms', '0ms'],
  sign?: -1 | 1,
) {
  return {
    heading: 'LH & Vitals',
    phaseName,
    sign,
    isSignificant,
    estimatorDelta,
    confidenceInterval,
    pValue: 0.01,
    controlSevenFigureSummary: { '50': controlValue },
    experimentSevenFigureSummary: { '50': experimentValue },
    asPercent: { percentMedian: 20 },
  };
}

async function readMetrics(vitalsTableData: ReturnType<typeof metric>[]) {
  const perTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-artifacts-test-'));
  fs.writeFileSync(
    path.join(perTestDir, 'report.json'),
    JSON.stringify({ vitalsTableData, diagnosticsTableData: [] }),
  );

  return readPerfArtifact({
    artifacts: new ArtifactScope(perTestDir, perTestDir),
    saveArtifacts: false,
    statisticalAnalysis: true,
  });
}

describe('readPerfArtifact', () => {
  it('returns paths for every successful render artifact', async () => {
    const resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-paths-test-'));
    const perTestDir = path.join(resultsRoot, 'checkout-desktop', 'artifacts');
    fs.mkdirSync(perTestDir, { recursive: true });
    fs.writeFileSync(path.join(perTestDir, 'timeline_comparison.html'), '<html></html>');
    fs.writeFileSync(path.join(perTestDir, 'timeline_preview.svg'), '<svg></svg>');
    fs.writeFileSync(path.join(perTestDir, 'side_by_side_frames.js'), ';');

    try {
      const artifact = await readPerfArtifact({
        artifacts: new ArtifactScope(perTestDir, resultsRoot),
        saveArtifacts: true,
        statisticalAnalysis: false,
      });

      expect(artifact).toMatchObject({
        timelineHref: 'checkout-desktop/artifacts/timeline_comparison.html',
        timelinePreviewHref: 'checkout-desktop/artifacts/timeline_preview.svg',
        framesHref: 'checkout-desktop/artifacts/side_by_side_frames.js',
      });
      expect(JSON.stringify(artifact)).not.toContain('data:');
    } finally {
      fs.rmSync(resultsRoot, { recursive: true, force: true });
    }
  });

  it('preserves numeric metric values beside their display values', async () => {
    const artifact = await readMetrics([
      metric('TBT', '20ms', true, 100, 120),
    ]);

    expect(artifact.metrics?.[0]).toMatchObject({
      controlValue: 100,
      experimentValue: 120,
      deltaValue: 20,
      deltaPercent: 20,
    });
  });

  it('follows the statistical verdict, whatever the size of the delta', async () => {
    const artifact = await readMetrics([
      metric('TTFB', '4ms'),
      metric('FCP', '-4ms'),
      metric('CLS', '1/100', true, 53.4, 54.4),
      metric('LCP', '300ms', false),
    ]);

    expect(artifact.metrics?.map((entry) => [entry.label, entry.direction])).toEqual([
      ['TTFB', 'regression'],
      ['FCP', 'improvement'],
      ['CLS', 'regression'],
      ['LCP', 'none'],
    ]);
    expect(artifact.regressedMetrics).toEqual(['TTFB', 'CLS']);
    expect(artifact.improvedMetrics).toEqual(['FCP']);
  });

  it('uses report-provided metric sign for custom higher-is-better scores', async () => {
    const artifact = await readMetrics([
      metric('SEO Score', '-2/100', true, 90, 88, ['-2/100', '-2/100'], -1),
    ]);

    expect(artifact.metrics?.find((entry) => entry.label === 'SEO Score')?.direction).toBe('regression');
    expect(artifact.regressedMetrics).toEqual(['SEO Score']);
  });
});
