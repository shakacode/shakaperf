/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeSessionAtomic, writeSummary } from '../persistence';
import type { BisectNextAction, BisectSession, BisectTarget } from '../types';

function target(
  id: string,
  category: BisectTarget['category'],
  firstBadSha: string,
): BisectTarget {
  return {
    id,
    category,
    testFile: `${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: id,
    status: 'found',
    goodIndex: 0,
    badIndex: 1,
    firstBadSha,
    observations: {},
  };
}

function session(targets: BisectTarget[] = []): BisectSession {
  return {
    status: 'running',
    mode: 'primary',
    identity: {
      controlRoot: '/repo/control', experimentRoot: '/repo/experiment',
      controlGitCommonDir: '/repo/control/.git', experimentGitCommonDir: '/repo/experiment/.git',
      controlOrigin: null, experimentOrigin: null,
    },
    compatibility: {
      configFingerprint: 'config', categoriesFingerprint: 'categories',
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg', 'perf', 'accessibility'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: null },
    rebuildStrategy: { mode: 'commands', commands: [] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
    primary: {
      id: 'primary', status: 'running', goodSha: 'good', badSha: 'bad',
      commitSubjects: { good: 'Initial baseline', bad: 'Introduce regression' },
      commitParents: { good: [], bad: ['good'] }, orderedCommits: ['good', 'bad'],
      targets, attempts: [],
    },
    mergeQueue: [],
    mergeInvestigations: {},
    commitRuns: {},
    startedAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('bisect persistence', () => {
  let resultsDirectory: string;

  beforeEach(() => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-bisect-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  it('writes session JSON atomically', () => {
    const sessionPath = path.join(resultsDirectory, 'session.json');

    writeSessionAtomic(sessionPath, session());

    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8'))).toMatchObject({
      status: 'running',
    });
    expect(fs.existsSync(`${sessionPath}.tmp`)).toBe(false);
  });

  it('writes first bad targets grouped by category priority', () => {
    const summaryPath = path.join(resultsDirectory, 'summary.json');

    writeSummary(summaryPath, session([
      target('tbt', 'perf', 'c'),
      target('button-name', 'accessibility', 'b'),
      target('visual', 'visreg', 'a'),
    ]));

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary).toMatchObject({
      status: 'running',
      goodSha: 'good',
      badSha: 'bad',
      commitSubjects: {
        good: 'Initial baseline',
        bad: 'Introduce regression',
      },
    });
    expect(summary.targets.map((item: BisectTarget) => [item.category, item.firstBadSha])).toEqual([
      ['visreg', 'a'],
      ['perf', 'c'],
      ['accessibility', 'b'],
    ]);
  });

  it('writes the dry-run next action into the compact summary', () => {
    const summaryPath = path.join(resultsDirectory, 'summary.json');
    const value = session();
    const nextAction: BisectNextAction = {
      kind: 'validate-good-ref',
      sha: 'good',
      categories: ['perf'],
      tests: [{ testFile: 'tests/checkout.abtest.ts', testName: 'Checkout' }],
      targetIds: ['target-1'],
    };

    writeSummary(summaryPath, value, {
      dryRun: true,
      validateGoodRef: true,
      nextAction,
    });

    expect(JSON.parse(fs.readFileSync(summaryPath, 'utf8'))).toMatchObject({
      dryRun: true,
      validateGoodRef: true,
      nextAction,
    });
  });
});
