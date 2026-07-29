/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import {
  BISECT_REPORT_FILENAME,
  clearPriorBisectReportOutput,
  writeBisectReport,
  writeBisectReportArtifacts,
} from '../report';
import type { BisectReportData } from '../report-model';

describe('writeBisectReport', () => {
  let resultsDirectory: string;

  beforeEach(() => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  it('writes a self-contained report with bisect data and inlined artifacts', () => {
    const screenshotPath = 'homepage/artifacts/control.png';
    const screenshotFile = path.join(resultsDirectory, screenshotPath);
    fs.mkdirSync(path.dirname(screenshotFile), { recursive: true });
    fs.writeFileSync(screenshotFile, 'fixture');
    const written = writeBisectReportArtifacts({
      resultsDirectory,
      data: reportData(screenshotPath),
      stages: [],
    });
    const { htmlPath, dataPath } = written;

    const html = fs.readFileSync(htmlPath, 'utf8');
    const saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    expect(htmlPath).toBe(path.join(resultsDirectory, BISECT_REPORT_FILENAME));
    expect(dataPath).toBe(path.join(resultsDirectory, 'bisect-report.json'));
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(html).toContain('"bisect":{"status":"complete"');
    const serializedPayload = html.match(
      /<script id="__shaka_report_data__" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(serializedPayload).toBeDefined();
    expect(saved).toEqual(JSON.parse(serializedPayload!));
    expect(saved.meta.reportMode).toBe('self-contained');
    expect(html).toContain(
      `data:image/png;base64,${Buffer.from('fixture').toString('base64')}`,
    );
    expect(html).not.toContain(screenshotPath);
  });

  it('returns an absolute path when resultsDirectory is relative', () => {
    const outputPath = writeBisectReport({
      resultsDirectory: path.relative(process.cwd(), resultsDirectory),
      data: reportData(),
      stages: [],
    });
    expect(path.isAbsolute(outputPath)).toBe(true);
  });

  it('preserves the prior report when the atomic replacement fails', () => {
    const outputPath = path.join(resultsDirectory, BISECT_REPORT_FILENAME);
    const dataPath = path.join(resultsDirectory, 'bisect-report.json');
    fs.writeFileSync(outputPath, 'prior report', 'utf8');
    fs.writeFileSync(dataPath, 'prior data', 'utf8');
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    try {
      expect(() => writeBisectReport({
        resultsDirectory,
        data: reportData(),
        stages: [],
      })).toThrow('rename failed');
      expect(fs.readFileSync(outputPath, 'utf8')).toBe('prior report');
      expect(fs.readFileSync(dataPath, 'utf8')).toBe('prior data');
    } finally {
      rename.mockRestore();
    }
  });

  it('clears both persisted report outputs before a new bisect run', () => {
    const htmlPath = path.join(resultsDirectory, BISECT_REPORT_FILENAME);
    const dataPath = path.join(resultsDirectory, 'bisect-report.json');
    fs.writeFileSync(htmlPath, 'prior report', 'utf8');
    fs.writeFileSync(dataPath, 'prior data', 'utf8');

    clearPriorBisectReportOutput(resultsDirectory);

    expect(fs.existsSync(htmlPath)).toBe(false);
    expect(fs.existsSync(dataPath)).toBe(false);
  });
});

function reportData(screenshot = '/tmp/control.png'): BisectReportData {
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
        measurement: { screenshot },
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
