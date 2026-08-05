/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { BisectReportData } from '../report-model';
import type { BisectSession } from '../types';
import { regenerateBisectReport } from '../report-only';

describe('regenerateBisectReport', () => {
  let resultsDirectory: string;

  beforeEach(() => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-report-only-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  it('rebuilds the model from the latest session while preserving saved cards', () => {
    const session = savedSession();
    const report = savedReport();
    writeJson('session.json', session);
    writeJson('bisect-report.json', report);

    const result = regenerateBisectReport({
      resultsDirectory,
      stages: [],
      now: '2026-07-13T12:00:00.000Z',
    });
    const saved = JSON.parse(fs.readFileSync(result.dataPath, 'utf8')) as BisectReportData;

    expect(result.session).toEqual(session);
    expect(saved.meta.reportOnly).toBe(true);
    expect(saved.meta.generatedAt).toBe('2026-07-13T12:00:00.000Z');
    expect(saved.tests).toEqual(report.tests);
    expect(saved.bisect.targets[0]).toEqual(expect.objectContaining({
      status: 'found',
      firstBadSha: 'middle',
    }));
    expect(fs.readFileSync(result.htmlPath, 'utf8')).toContain('"reportOnly":true');
  });

  it.each([
    ['missing session', undefined, savedReport(), /session\.json.*not found/i],
    ['invalid session', { version: 2 }, savedReport(), /session\.json.*invalid/i],
    ['missing report data', savedSession(), undefined, /bisect-report\.json.*not found/i],
    ['invalid report data', savedSession(), { tests: [] }, /bisect-report\.json.*invalid/i],
  ])('preserves prior HTML for %s', (_name, session, report, expectedError) => {
    if (session !== undefined) writeJson('session.json', session);
    if (report !== undefined) writeJson('bisect-report.json', report);
    const htmlPath = path.join(resultsDirectory, 'bisect-report.html');
    fs.writeFileSync(htmlPath, 'prior report', 'utf8');

    expect(() => regenerateBisectReport({
      resultsDirectory,
      stages: [],
      now: '2026-07-13T12:00:00.000Z',
    })).toThrow(expectedError);
    expect(fs.readFileSync(htmlPath, 'utf8')).toBe('prior report');
  });

  function writeJson(name: string, value: unknown): void {
    fs.writeFileSync(path.join(resultsDirectory, name), JSON.stringify(value), 'utf8');
  }
});

function savedSession(): BisectSession {
  const targetId = '["visreg","homepage","desktop","document"]';
  const targets = [{
    id: targetId,
    category: 'visreg' as const,
    testFile: 'tests/homepage.abtest.ts',
    testName: 'Homepage',
    viewport: 'desktop',
    subject: 'document',
    status: 'found' as const,
    firstBadSha: 'middle',
    recordedTargetEvaluations: {},
  }];
  return {
    status: 'complete',
    mode: 'complete',
    identity: {
      controlRoot: '/repo/control',
      experimentRoot: '/repo/experiment',
      controlGitCommonDir: '/repo/control/.git',
      experimentGitCommonDir: '/repo/experiment/.git',
      controlOrigin: 'git@example.com:repo.git',
      experimentOrigin: 'git@example.com:repo.git',
    },
    compatibility: {
      configFingerprint: 'config',
      categoriesFingerprint: 'categories',
      testsFingerprint: 'tests',
      rebuildFingerprint: 'rebuild',
      rangeFingerprint: 'range',
      effective: {
        config: {},
        categories: ['visreg'],
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
        rebuildStrategy: { mode: 'commands', commands: ['yarn build'] },
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: null },
    rebuildStrategy: { mode: 'commands', commands: ['yarn build'] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
    commitRuns: {},
    primary: {
      id: 'primary',
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      orderedCommits: ['good', 'middle', 'bad'],
      commitSubjects: { good: 'Baseline', middle: 'Break homepage', bad: 'Bad tip' },
      commitParents: { good: [], middle: ['good'], bad: ['middle'] },
      targets,
      attempts: [],
      startedAt: '2026-07-13T10:00:00.000Z',
      finishedAt: '2026-07-13T11:00:00.000Z',
    },
    mergeQueue: [],
    mergeInvestigations: {},
    startedAt: '2026-07-13T10:00:00.000Z',
    finishedAt: '2026-07-13T11:00:00.000Z',
  };
}

function savedReport(): BisectReportData {
  return {
    meta: {
      title: 'Bisect report',
      pipelineName: 'compare',
      generatedAt: '2026-07-13T11:00:00.000Z',
      controlUrl: 'http://control.test',
      experimentUrl: 'http://experiment.test',
      durationMs: 0,
      cwd: '/tmp/project',
      errors: [],
      reportOnly: false,
      pipelineConfig: {},
      reportMode: 'self-contained',
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
        measurement: { screenshot: 'data:image/png;base64,fixture' },
      }],
      viewportArtifactPaths: [],
    }],
    bisect: {
      status: 'running',
      goodSha: 'good',
      badSha: 'bad',
      generatedAt: '2026-07-13T11:00:00.000Z',
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
