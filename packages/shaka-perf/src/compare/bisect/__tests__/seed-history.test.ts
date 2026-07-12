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
  'f2cd5c9016e5e758c335e4d5c90eb7bb1a01e4bf',
  '267da307e57d0aa217dd0b8dad2ff58be9d8c2b2',
  'aa1b86ae9ab48392844741b2cd90249eab11a9de',
  'c9b2c71c10fb28f0d6ee4b7d48c5736795144878',
  'a24c926d4a195a58ea04b49c780bec86a2ea6b95',
  '5d38dcfb0002cb28d9465e7e8fbab4839c1230f7',
  '4dbb382fdd67dd18108e33b0995dcca2ad44999a',
  'af79cafd66b1ee097ecdbecbc014f43b28ffb5cd',
  'c0adc35333c3760d4411d8d951696132fe9a2024',
  '38e78824044e63179d86d558b614b41c9cd710e1',
  '5956eb6b2ad8b5e939a2b53633739a2232a21670',
  'db65ccdf074819d43152b061a7960d06c55eb297',
  '5c3dbad44b5aba5d8eb7222d75f1deb9efa050d4',
  '993637a214f92955fc2b7f076be6ac890be5453b',
  '5e4c3203c340e950550044838d812555cfa920a5',
  '780f5a55d4605cf501b1adb8e338b69ac81b06ff',
];

const seedRegressionsByCommit = {
  aa1b86ae9ab48392844741b2cd90249eab11a9de: ['homepage-hero-visual'],
  '5d38dcfb0002cb28d9465e7e8fbab4839c1230f7': ['homepage-tbt'],
  '38e78824044e63179d86d558b614b41c9cd710e1': ['homepage-button-name'],
  '993637a214f92955fc2b7f076be6ac890be5453b': [
    'product-detail-visual',
    'product-detail-tbt',
  ],
} as const;

type SeedTargetId =
  (typeof seedRegressionsByCommit)[keyof typeof seedRegressionsByCommit][number];

const expectedFirstBad = {
  'homepage-hero-visual': 'aa1b86ae9ab48392844741b2cd90249eab11a9de',
  'homepage-tbt': '5d38dcfb0002cb28d9465e7e8fbab4839c1230f7',
  'homepage-button-name': '38e78824044e63179d86d558b614b41c9cd710e1',
  'product-detail-visual': '993637a214f92955fc2b7f076be6ac890be5453b',
  'product-detail-tbt': '993637a214f92955fc2b7f076be6ac890be5453b',
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
