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
import { createInitialTargetGroup, partitionTargetGroup } from '../search';
import type {
  BisectCategory,
  BisectTarget,
} from '../types';

const seedCommits = [
  '976ae3d2921077b9074eae16fd09d1521e9d5766',
  '3f2dc38f4eef71821f7ec35b094cf1d17b1a7ff7',
  '07d16663c76892222c758526625b7ed12643c3c6',
  '429f40b66d588d3c289b4c148bc086dd9b6af7c7',
  'b2b07f8586108ac3ceeae051d4893add7b7de1c9',
  '22cdde554c5f37d4c959ab027aa835843a0e137f',
  'dd9f91f778fc920bd4d08d4afacda43b4ad23d59',
  '2166ac5857164c878f291b80c3025ed1be7a3590',
  'f6c8e30cdfb99d1740c53cf7089c8e2c63a29df3',
  '1d076f7dd00245a5142b4f8025de1a798776427c',
  '7086fd07e06888a79f7e7daa06c01e6c06ca39bc',
  '9e391068a75bc117fbcfdc58a773381c9d9989b8',
  'b29c5da2dca4a585ef5a0a62301a309c6f978125',
  'a6286c20bf7aca8004bec132f53408af4eab0e67',
  'e31960fd65dc464039c8f2a57edc4a7f90a0ab41',
  'b792e01fffc14bc7c3f180403620fa39a2db1565',
  'bee8480d08982dcee4868303f6d61d56e9544796',
  '444f479ed081c1a99a7a5d7073c8c54547c6af4d',
];

const seedRegressionsByCommit = {
  '429f40b66d588d3c289b4c148bc086dd9b6af7c7': ['homepage-hero-visual'],
  'dd9f91f778fc920bd4d08d4afacda43b4ad23d59': ['homepage-tbt'],
  '7086fd07e06888a79f7e7daa06c01e6c06ca39bc': ['homepage-button-name'],
  'e31960fd65dc464039c8f2a57edc4a7f90a0ab41': [
    'product-detail-visual',
    'product-detail-tbt',
  ],
} as const;

type SeedTargetId =
  (typeof seedRegressionsByCommit)[keyof typeof seedRegressionsByCommit][number];

const expectedFirstBad = {
  'homepage-hero-visual': '429f40b66d588d3c289b4c148bc086dd9b6af7c7',
  'homepage-tbt': 'dd9f91f778fc920bd4d08d4afacda43b4ad23d59',
  'homepage-button-name': '7086fd07e06888a79f7e7daa06c01e6c06ca39bc',
  'product-detail-visual': 'e31960fd65dc464039c8f2a57edc4a7f90a0ab41',
  'product-detail-tbt': 'e31960fd65dc464039c8f2a57edc4a7f90a0ab41',
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
    viewport: 'phone',
    subject,
    status: 'active',
    recordedTargetEvaluations: {},
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
    const pending = [createInitialTargetGroup('initial', seedCommits[0]!, seedCommits.at(-1)!, targets)];
    const found: Record<string, string> = {};
    while (pending.length) {
      const group = pending.pop()!;
      const good = seedCommits.indexOf(group.goodSha);
      const bad = seedCommits.indexOf(group.badSha);
      if (bad === good + 1) {
        for (const id of group.targetIds) found[id] = group.badSha;
        continue;
      }
      const index = Math.floor((good + bad) / 2);
      const sha = seedCommits[index]!;
      const regressions = new Set(seedCommits.slice(0, index + 1).flatMap(
        (commit) => seedRegressionsByCommit[commit as keyof typeof seedRegressionsByCommit] ?? [],
      ));
      const result = partitionTargetGroup({
        group, targets, sha, queuedGroupId: group.id + '-split',
        evaluations: group.targetIds.map((targetId) => ({
          targetId, commitSha: sha, regressionDetected: regressions.has(targetId as SeedTargetId),
          evidence: { fixture: true }, evidenceArtifacts: [],
        })),
      });
      targets = result.targets;
      pending.push(result.continuingGroup, ...result.queuedGroups);
    }
    expect(found).toEqual(expectedFirstBad);
  });
});
