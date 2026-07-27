/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  candidatePlanForGroup,
  createInitialTargetGroup,
  partitionTargetGroup,
} from '../search';
import type {
  BisectCategory,
  BisectTarget,
  BisectTargetGroup,
  TargetEvaluationAtCommit,
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
    recordedTargetEvaluations: {},
  };
}

function evaluation(
  targetId: string,
  commitSha: string,
  regressionDetected: boolean,
): TargetEvaluationAtCommit {
  return {
    targetId,
    commitSha,
    regressionDetected,
    evidence: { fixture: true },
    evidenceArtifacts: [],
  };
}

function seedTargets(): BisectTarget[] {
  return [
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
  ];
}

describe('demo ecommerce bisect seed history fixture', () => {
  it('clears persistent build output before precompiling each candidate', () => {
    const configPath = path.resolve(
      __dirname,
      '../../../../../../demo-ecommerce/abtests.config.ts',
    );

    expect(fs.readFileSync(configPath, 'utf8')).toContain(
      "command: 'rm -rf public/packs tmp/cache && SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile'",
    );
  });

  it('finds the documented first bad commit for every seeded regression target', () => {
    let targets = seedTargets();
    const groups: BisectTargetGroup[] = [createInitialTargetGroup(
      'seed-group-1',
      seedCommits[0],
      seedCommits.at(-1)!,
      targets,
    )];
    let nextGroupId = 2;

    while (groups.length > 0) {
      let group = groups.shift()!;
      while (seedCommits.indexOf(group.badSha) - seedCommits.indexOf(group.goodSha) > 1) {
        const goodIndex = seedCommits.indexOf(group.goodSha);
        const badIndex = seedCommits.indexOf(group.badSha);
        const candidateIndex = Math.floor((goodIndex + badIndex) / 2);
        const candidateSha = seedCommits[candidateIndex];
        const work = candidatePlanForGroup(group, targets, candidateSha);
        const regressionsPresent = new Set(
          seedCommits
            .slice(0, candidateIndex + 1)
            .flatMap(
              (sha) => seedRegressionsByCommit[sha as keyof typeof seedRegressionsByCommit] ?? [],
            ),
        );
        const partition = partitionTargetGroup({
          group,
          targets,
          sha: candidateSha,
          evaluations: work.targetIds.map((targetId) => evaluation(
            targetId,
            candidateSha,
            regressionsPresent.has(targetId as SeedTargetId),
          )),
          queuedGroupId: `seed-group-${nextGroupId++}`,
        });
        targets = partition.targets;
        group = partition.continuingGroup;
        groups.push(...partition.queuedGroups);
      }

      const completedTargetIds = new Set(group.targetIds);
      targets = targets.map((item) => completedTargetIds.has(item.id)
        ? { ...item, status: 'found', firstBadSha: group.badSha }
        : item);
    }

    expect(Object.fromEntries(
      targets.map((item) => [item.id, item.firstBadSha]),
    )).toEqual(expectedFirstBad);
    expect(targets.every((item) => item.status === 'found')).toBe(true);
  });
});
