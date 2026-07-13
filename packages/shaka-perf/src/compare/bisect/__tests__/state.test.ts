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
import {
  assertCompatible,
  buildCompatibility,
  fingerprint,
  parseBisectSession,
  readBadRefTests,
  writeBadRefTestsAtomic,
} from '../state';
import type { BisectSessionV2 } from '../types';

function session(): BisectSessionV2 {
  return {
    version: 2,
    status: 'running',
    mode: 'primary',
    identity: {
      controlRoot: '/repo/control',
      experimentRoot: '/repo/experiment',
      controlGitCommonDir: '/repo/control/.git',
      experimentGitCommonDir: '/repo/experiment/.git',
      controlOrigin: 'git@example.com:repo.git',
      experimentOrigin: 'git@example.com:repo.git',
    },
    compatibility: buildCompatibility({
      config: { sourcePath: '/repo/abtests.config.ts', contents: 'config-v1' },
      categories: ['visreg', 'perf'],
      tests: [{ testFile: 'tests/home.abtest.ts', testName: 'Homepage' }],
      rebuildStrategy: { mode: 'commands', commands: ['yarn build'] },
      range: { goodSha: 'good', badSha: 'bad' },
    }),
    originalExperiment: { branch: 'feature', sha: 'bad' },
    control: { branch: null, sha: 'good' },
    rebuildStrategy: { mode: 'commands', commands: ['yarn build'] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'abc' },
    primary: {
      id: 'primary',
      status: 'running',
      goodSha: 'good',
      badSha: 'bad',
      orderedCommits: ['good', 'mid', 'bad'],
      commitSubjects: { good: 'good', mid: 'mid', bad: 'bad' },
      commitParents: { good: [], mid: ['good'], bad: ['mid'] },
      targets: [],
      attempts: [{
        id: 'attempt-1',
        sha: 'mid',
        status: 'running',
        requestedCategories: ['visreg'],
        requestedTests: [{ testFile: 'tests/home.abtest.ts', testName: 'Homepage' }],
        refreshMode: 'commands',
        usedFallback: false,
        startedAt: '2026-07-13T00:01:00.000Z',
      }],
      startedAt: '2026-07-13T00:00:00.000Z',
    },
    mergeQueue: [],
    mergeInvestigations: {},
    startedAt: '2026-07-13T00:00:00.000Z',
  };
}

describe('resumable bisect state', () => {
  it('rejects version-1 diagnostic sessions with a specific explanation', () => {
    expect(() => parseBisectSession({ version: 1 })).toThrow(/predates resumable state/i);
  });

  it('strictly parses version-2 sessions and normalizes crashed attempts', () => {
    const parsed = parseBisectSession(session());

    expect(parsed.version).toBe(2);
    expect(parsed.primary.attempts).toMatchObject([{
      id: 'attempt-1',
      status: 'incomplete',
      error: 'process stopped before the attempt completed',
    }]);
  });

  it('rejects unknown persisted fields', () => {
    expect(() => parseBisectSession({ ...session(), unexpected: true })).toThrow(/unrecognized/i);
  });

  it('fingerprints objects independently of object key order', () => {
    expect(fingerprint({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(fingerprint({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('normalizes category order while retaining exact test pairs', () => {
    const left = buildCompatibility({
      config: { contents: 'same' },
      categories: ['visreg', 'perf'],
      tests: [
        { testFile: 'tests/b.abtest.ts', testName: 'Overview' },
        { testFile: 'tests/a.abtest.ts', testName: 'Overview' },
      ],
      rebuildStrategy: { mode: 'container', commands: [] },
      range: { goodSha: 'good', badSha: 'bad' },
    });
    const right = buildCompatibility({
      config: { contents: 'same' },
      categories: ['perf', 'visreg'],
      tests: [
        { testFile: 'tests/a.abtest.ts', testName: 'Overview' },
        { testFile: 'tests/b.abtest.ts', testName: 'Overview' },
      ],
      rebuildStrategy: { mode: 'container', commands: [] },
      range: { goodSha: 'good', badSha: 'bad' },
    });

    expect(left).toEqual(right);
  });

  it.each([
    ['configFingerprint', 'configuration changed'],
    ['categoriesFingerprint', 'selected categories changed'],
    ['testsFingerprint', 'frozen AB tests changed'],
    ['rebuildFingerprint', 'rebuild strategy changed'],
    ['rangeFingerprint', 'resolved Git range changed'],
  ] as const)('reports an actionable %s incompatibility', (field, message) => {
    const saved = session().compatibility;
    const current = { ...saved, [field]: 'changed' };

    expect(() => assertCompatible(saved, current)).toThrow(new RegExp(message, 'i'));
  });
});

describe('persisted bad-ref report input', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-state-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('writes atomically and validates the saved digest', () => {
    const filePath = path.join(rootDir, 'bad-ref-tests.json');
    const tests = [{ id: 'homepage', name: 'Homepage', filePath: 'tests/home.abtest.ts' }];

    const sha256 = writeBadRefTestsAtomic(filePath, tests as never);

    expect(readBadRefTests(filePath, sha256)).toEqual(tests);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('rejects missing and changed report input', () => {
    const filePath = path.join(rootDir, 'bad-ref-tests.json');
    expect(() => readBadRefTests(filePath, 'missing')).toThrow(/missing/i);

    const sha256 = writeBadRefTestsAtomic(filePath, []);
    fs.writeFileSync(filePath, '[]\n ', 'utf8');
    expect(() => readBadRefTests(filePath, sha256)).toThrow(/changed/i);
  });
});
