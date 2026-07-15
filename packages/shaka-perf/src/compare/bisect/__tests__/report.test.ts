/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { BISECT_REPORT_FILENAME, writeBisectReport } from '../report';
import type { BisectReportData } from '../report-model';
import type { Stage } from '../../../stage/stage';

describe('writeBisectReport', () => {
  let resultsDirectory: string;

  beforeEach(() => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  it('writes a self-contained report with bisect data and inlined artifacts', () => {
    const outputPath = writeBisectReport({
      resultsDirectory,
      data: reportData(),
      stages: [
        {
          name: 'visreg',
          stripMeasurementForLightweight: (measurement: { screenshot: string }) => ({
            screenshot: measurement.screenshot === '/tmp/control.png'
              ? 'data:image/png;base64,fixture'
              : measurement.screenshot,
          }),
        } as Stage<{ screenshot: string }>,
      ],
    });

    const html = fs.readFileSync(outputPath, 'utf8');

    expect(outputPath).toBe(path.join(resultsDirectory, BISECT_REPORT_FILENAME));
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(html).toContain('"bisect":{"status":"complete"');
    const serializedPayload = html.match(
      /<script id="__shaka_report_data__" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(serializedPayload).toBeDefined();
    expect(JSON.parse(serializedPayload!).meta.reportMode).toBe('lightweight');
    expect(html).toContain('data:image/png;base64,fixture');
    expect(html).not.toContain('/tmp/control.png');
  });

  it('returns an absolute path when resultsDirectory is relative', () => {
    const outputPath = writeBisectReport({
      resultsDirectory: path.relative(process.cwd(), resultsDirectory),
      data: reportData(),
      stages: [],
    });

    expect(path.isAbsolute(outputPath)).toBe(true);
  });
});

function reportData(): BisectReportData {
  return {
    meta: {
      title: 'Bisect report',
      generatedAt: '2026-07-13T00:00:00.000Z',
      controlUrl: 'http://control.test',
      experimentUrl: 'http://experiment.test',
      durationMs: 0,
      cwd: '/tmp',
      errors: [],
      reportOnly: false,
      pipelineConfig: {},
      reportMode: 'full',
    },
    tests: [{
      id: 'homepage',
      name: 'Homepage',
      filePath: 'tests/homepage.abtest.ts',
      startingPath: '/',
      controlUrl: 'http://control.test/',
      experimentUrl: 'http://experiment.test/',
      code: null,
      chips: [],
      sorts: [],
      durationMs: 0,
      measuredAt: null,
      runId: null,
      outcomes: [{
        kind: 'ok',
        stage: 'visreg',
        viewport: DESKTOP_VIEWPORT,
        measurement: { screenshot: '/tmp/control.png' },
      }],
      viewportArtifactPaths: [],
    }],
    bisect: {
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      generatedAt: '2026-07-13T00:00:00.000Z',
      commits: [],
      targets: [],
      targetsById: {},
      views: {
        unresolved: { targetIds: [] },
        invalid: { targetIds: [] },
      },
    },
  };
}
