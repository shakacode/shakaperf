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
import type { BisectSession, BisectTarget } from '../types';

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
    version: 1,
    status: 'running',
    goodSha: 'good',
    badSha: 'bad',
    originalExperiment: { sha: 'bad', branch: 'feature' },
    selectedCategories: ['visreg', 'perf', 'accessibility'],
    orderedCommits: ['good', 'bad'],
    targets,
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
      version: 1,
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
    expect(summary).toMatchObject({ version: 1, status: 'running', goodSha: 'good', badSha: 'bad' });
    expect(summary.targets.map((item: BisectTarget) => [item.category, item.firstBadSha])).toEqual([
      ['visreg', 'a'],
      ['perf', 'c'],
      ['accessibility', 'b'],
    ]);
  });

  it('writes the dry-run next action into the compact summary', () => {
    const summaryPath = path.join(resultsDirectory, 'summary.json');
    const value = session();
    value.dryRun = true;
    value.nextAction = {
      kind: 'validate-good-ref',
      sha: 'good',
      categories: ['perf'],
      testFiles: ['tests/checkout.abtest.ts'],
      targetIds: ['target-1'],
    };

    writeSummary(summaryPath, value);

    expect(JSON.parse(fs.readFileSync(summaryPath, 'utf8'))).toMatchObject({
      dryRun: true,
      nextAction: value.nextAction,
    });
  });
});
