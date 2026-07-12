/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { applyCachedObservations, applyObservations, nextCandidate } from '../search';
import type {
  BisectCategory,
  BisectSession,
  BisectTarget,
  TargetObservation,
} from '../types';

const seedCommits = [
  '38dae6871b8b443dd1880269dacde951700e77cc',
  '623a1ae6f39cb6cbddd550ecd33d83c670877d14',
  'fe8900e2568f11d05e41d43ad62e0aa863017264',
  '58cc828b7272cd69408fa4dc5cd36206dcd8846a',
  'a55e7f44dea86afa94775cf448dc3e696c71ed33',
  '754fcd9b72b5623118a9bc1fb84b87ec98e002e1',
  '9c7cfff6c0ca9bd561f5bb9905a1b09ee3132d1e',
  '744fe902ab6b087f761f2df7e1f52bcc2e88d1c1',
  'ac38e5320e6c33b67474f445c15e3012e22fb491',
  '463c4296e003fafe5dc4e23f5f43e805e555938d',
  'fcb0e2b107a99c6e4edab01da114d4d83b3d7a94',
  'c1e2a62486870b02354c0c5b8727f8944e4913a3',
  'ce1f6015bfd01e05228d94affb788fe5f0d896a0',
  '3846371172486d851b836883c54520cc1b844199',
  '5345dffb62b761b9cb0e1516a6bbd4389a6cf642',
  '088afb9342d8c4337361df177e3731550b096fc9',
  '4406a7800cfec9af52e9f7e731a1ad59915ac227',
  'f7b872f2a6d5817be15261b4d9f21a4f6814126f',
];

const seedRegressionsByCommit = {
  '58cc828b7272cd69408fa4dc5cd36206dcd8846a': ['homepage-hero-visual'],
  '9c7cfff6c0ca9bd561f5bb9905a1b09ee3132d1e': ['homepage-tbt'],
  'fcb0e2b107a99c6e4edab01da114d4d83b3d7a94': ['homepage-button-name'],
  '5345dffb62b761b9cb0e1516a6bbd4389a6cf642': [
    'product-detail-visual',
    'product-detail-tbt',
  ],
} as const;

type SeedTargetId =
  (typeof seedRegressionsByCommit)[keyof typeof seedRegressionsByCommit][number];

const expectedFirstBad = {
  'homepage-hero-visual': '58cc828b7272cd69408fa4dc5cd36206dcd8846a',
  'homepage-tbt': '9c7cfff6c0ca9bd561f5bb9905a1b09ee3132d1e',
  'homepage-button-name': 'fcb0e2b107a99c6e4edab01da114d4d83b3d7a94',
  'product-detail-visual': '5345dffb62b761b9cb0e1516a6bbd4389a6cf642',
  'product-detail-tbt': '5345dffb62b761b9cb0e1516a6bbd4389a6cf642',
} as const;

function target(
  id: keyof typeof expectedFirstBad,
  category: BisectCategory,
  testFile: string,
  testName: string,
  subject: string,
): BisectTarget {
  return {
    id,
    category,
    testFile,
    testName,
    viewport: 'desktop',
    subject,
    status: 'active',
    goodIndex: 0,
    badIndex: seedCommits.length - 1,
    observations: {},
  };
}

function observation(
  targetId: string,
  commitSha: string,
  present: boolean,
): TargetObservation {
  return {
    targetId,
    commitSha,
    present,
    values: { fixture: true },
    artifacts: [],
  };
}

function seedSession(): BisectSession {
  return {
    version: 1,
    status: 'running',
    goodSha: seedCommits[0],
    badSha: seedCommits.at(-1)!,
    originalExperiment: { sha: seedCommits.at(-1)!, branch: 'codex/git-bisect-demo-history' },
    selectedCategories: ['visreg', 'perf', 'accessibility'],
    orderedCommits: seedCommits,
    targets: [
      target(
        'homepage-hero-visual',
        'visreg',
        'demo-ecommerce/ab-tests/homepage.abtest.ts',
        'Homepage',
        '[data-cy="hero-section"]',
      ),
      target('homepage-tbt', 'perf', 'demo-ecommerce/ab-tests/homepage.abtest.ts', 'Homepage', 'TBT'),
      target(
        'homepage-button-name',
        'accessibility',
        'demo-ecommerce/ab-tests/homepage.abtest.ts',
        'Homepage',
        'button-name',
      ),
      target(
        'product-detail-visual',
        'visreg',
        'demo-ecommerce/ab-tests/product-detail.abtest.ts',
        'Product Detail',
        'document',
      ),
      target(
        'product-detail-tbt',
        'perf',
        'demo-ecommerce/ab-tests/product-detail.abtest.ts',
        'Product Detail',
        'TBT',
      ),
    ],
    commitRuns: {},
    startedAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('demo ecommerce bisect seed history fixture', () => {
  it('finds the documented first bad commit for every seeded regression target', () => {
    let session = seedSession();

    while (true) {
      const normalized = applyCachedObservations(session);
      const work = nextCandidate(normalized);
      if (!work) {
        session = normalized;
        break;
      }
      const candidateIndex = seedCommits.indexOf(work.sha);
      const regressionsPresent = new Set(
        seedCommits
          .slice(0, candidateIndex + 1)
          .flatMap(
            (sha) => seedRegressionsByCommit[sha as keyof typeof seedRegressionsByCommit] ?? [],
          ),
      );
      session = applyObservations(normalized, work.sha, new Map(
        work.targetIds.map((targetId) => [
          targetId,
          observation(
            targetId,
            work.sha,
            regressionsPresent.has(targetId as SeedTargetId),
          ),
        ]),
      ));
    }

    expect(Object.fromEntries(
      session.targets.map((item) => [item.id, item.firstBadSha]),
    )).toEqual(expectedFirstBad);
    expect(session.targets.every((item) => item.status === 'found')).toBe(true);
  });
});
