/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BisectRepairConfig } from '../../../config';
import { runBisect } from '../session';
import type {
  E2eDependencyHarness,
  E2eRepositoryFixture,
} from './e2e-fixture';
import {
  assertExperimentRestored,
  createE2eDependencies,
  createLinearFixture,
  createMergeFixture,
  expectBinarySearchTraversal,
  expectFirstBadCommits,
  expectMergeAttributions,
  readPersistedSession,
  regressionTimeline,
  stubRegression,
  visregTimeline,
} from './e2e-fixture';

jest.setTimeout(30_000);

describe('bisect black-box E2E', () => {
  /*
   * known-good -> visual-regression-introduced -> performance-regression-introduced
   *                 ^ first visual
   *               ^ first performance
   * -> accessibility-regression-introduced -> all-regressions-confirmed
   *    ^ first accessibility
   * -> good-unrelated-commit-one -> good-unrelated-commit-two
   *    ^ skipped                     ^ skipped
   * -> regressions-still-detected -> known-bad
   */
  it('finds different regression types at their independent first bad commits', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'visual-regression-introduced',
      'performance-regression-introduced',
      'accessibility-regression-introduced',
      'all-regressions-confirmed',
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'regressions-still-detected',
      'known-bad',
    ]);
    try {
      const visual = stubRegression('visual', 'visreg');
      const performance = stubRegression('performance', 'perf');
      const accessibility = stubRegression('accessibility', 'accessibility');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual, performance, accessibility], {
          'known-good': [],
          'visual-regression-introduced': ['visual'],
          'performance-regression-introduced': ['visual', 'performance'],
          'accessibility-regression-introduced': ['visual', 'performance', 'accessibility'],
          'all-regressions-confirmed': ['visual', 'performance', 'accessibility'],
          'good-unrelated-commit-one': ['visual', 'performance', 'accessibility'],
          'good-unrelated-commit-two': ['visual', 'performance', 'accessibility'],
          'regressions-still-detected': ['visual', 'performance', 'accessibility'],
          'known-bad': ['visual', 'performance', 'accessibility'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf', 'accessibility'],
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'visual-regression-introduced' },
        { regression: performance, commit: 'performance-regression-introduced' },
        { regression: accessibility, commit: 'accessibility-regression-introduced' },
      ]);
      const targetIdByCategory = Object.fromEntries(session.primary.targets.map((target) => (
        [target.category, target.id]
      )));
      expect(session.primary.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: 'complete',
          targetIds: [targetIdByCategory.visreg],
          firstBadSha: fixture.shas['visual-regression-introduced'],
        }),
        expect.objectContaining({
          status: 'complete',
          targetIds: [targetIdByCategory.perf],
          firstBadSha: fixture.shas['performance-regression-introduced'],
        }),
        expect.objectContaining({
          status: 'complete',
          targetIds: [targetIdByCategory.accessibility],
          firstBadSha: fixture.shas['accessibility-regression-introduced'],
        }),
      ]));
      expect(session.primary.groups).toHaveLength(3);
      expect(session.primary.groups[0]).toMatchObject({
        id: 'primary-group-1',
        targetIds: [targetIdByCategory.visreg],
        decisions: expect.arrayContaining([
          {
            sha: fixture.shas['performance-regression-introduced'],
            verdict: 'bad',
          },
          {
            sha: fixture.shas['visual-regression-introduced'],
            verdict: 'bad',
          },
        ]),
      });
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'all-regressions-confirmed',
        'performance-regression-introduced',
        'visual-regression-introduced',
        'accessibility-regression-introduced',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  it('resumes a queued divergent target group without repeating completed groups', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'visual-regression-introduced',
      'performance-regression-introduced',
      'accessibility-regression-introduced',
      'all-regressions-confirmed',
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'regressions-still-detected',
      'known-bad',
    ]);
    try {
      const visual = stubRegression('visual', 'visreg');
      const performance = stubRegression('performance', 'perf');
      const accessibility = stubRegression('accessibility', 'accessibility');
      const resultsBySha = regressionTimeline(fixture, [visual, performance, accessibility], {
        'known-good': [],
        'visual-regression-introduced': ['visual'],
        'performance-regression-introduced': ['visual', 'performance'],
        'accessibility-regression-introduced': ['visual', 'performance', 'accessibility'],
        'all-regressions-confirmed': ['visual', 'performance', 'accessibility'],
        'good-unrelated-commit-one': ['visual', 'performance', 'accessibility'],
        'good-unrelated-commit-two': ['visual', 'performance', 'accessibility'],
        'regressions-still-detected': ['visual', 'performance', 'accessibility'],
        'known-bad': ['visual', 'performance', 'accessibility'],
      });
      const interruptedHarness = createE2eDependencies({
        fixture,
        resultsBySha,
        failAtSha: fixture.shas['accessibility-regression-introduced'],
      });

      await expect(runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf', 'accessibility'],
        dependencies: interruptedHarness.dependencies,
      })).rejects.toThrow(/stubbed compare failure/i);

      const interrupted = readPersistedSession(fixture);
      expect(interrupted.primary.targets.filter((target) => target.status === 'found')).toHaveLength(1);
      expect(interrupted.primary.groups.filter((group) => group.status === 'complete')).toHaveLength(1);
      expect(interrupted.primary.groups.filter((group) => group.status !== 'complete')).toHaveLength(2);
      assertExperimentRestored(fixture);

      const resumeHarness = createE2eDependencies({ fixture, resultsBySha });
      const resumed = await runBisect({
        ...fixture.runOptions,
        resume: true,
        selectedCategories: ['visreg', 'perf', 'accessibility'],
        dependencies: resumeHarness.dependencies,
      });

      expectFirstBadCommits(resumed, fixture, [
        { regression: visual, commit: 'visual-regression-introduced' },
        { regression: performance, commit: 'performance-regression-introduced' },
        { regression: accessibility, commit: 'accessibility-regression-introduced' },
      ]);
      expectBinarySearchTraversal(resumeHarness, fixture, ['accessibility-regression-introduced']);
      expect(resumed.primary.groups.every((group) => group.status === 'complete')).toBe(true);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> good-unrelated-commit-one -> good-unrelated-commit-two
   *                 ^ skipped                    ^ skipped
   * -> good-unrelated-commit-traversed -> clean-before-regressions
   *    ^ traversed good commit
   * -> visual-and-performance-regressions-introduced
   *    ^ first visual/performance
   * -> regressions-confirmed -> known-bad
   */
  it('finds multiple regressions introduced by one commit with shared candidate work', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'good-unrelated-commit-traversed',
      'clean-before-regressions',
      'visual-and-performance-regressions-introduced',
      'regressions-confirmed',
      'known-bad',
    ]);
    try {
      const visual = stubRegression('visual', 'visreg');
      const performance = stubRegression('performance', 'perf');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual, performance], {
          'known-good': [],
          'good-unrelated-commit-one': [],
          'good-unrelated-commit-two': [],
          'good-unrelated-commit-traversed': [],
          'clean-before-regressions': [],
          'visual-and-performance-regressions-introduced': ['visual', 'performance'],
          'regressions-confirmed': ['visual', 'performance'],
          'known-bad': ['visual', 'performance'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf'],
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'visual-and-performance-regressions-introduced' },
        { regression: performance, commit: 'visual-and-performance-regressions-introduced' },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'good-unrelated-commit-traversed',
        'visual-and-performance-regressions-introduced',
        'clean-before-regressions',
      ]);
      expect(harness.candidateComparisonCalls.filter((call) => (
        call.sha === fixture.shas['visual-and-performance-regressions-introduced']
      ))).toHaveLength(1);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> homepage-regression-introduced -> good-unrelated-commit-one
   *                 ^ first homepage
   *                 skipped ^
   * -> homepage-regression-confirmed -> cart-regression-introduced
   *                                    ^ first cart
   * -> good-unrelated-commit-two -> known-bad
   *    ^ skipped
   */
  it('narrows different exact tests in one category to separate first bad commits', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'homepage-regression-introduced',
      'good-unrelated-commit-one',
      'homepage-regression-confirmed',
      'cart-regression-introduced',
      'good-unrelated-commit-two',
      'known-bad',
    ]);
    try {
      const homepage = stubRegression('homepage', 'visreg', {
        testFile: 'tests/homepage.abtest.ts',
        testName: 'Homepage',
      });
      const cart = stubRegression('cart', 'visreg', {
        testFile: 'tests/cart.abtest.ts',
        testName: 'Cart',
      });
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [homepage, cart], {
          'known-good': [],
          'homepage-regression-introduced': ['homepage'],
          'good-unrelated-commit-one': ['homepage'],
          'homepage-regression-confirmed': ['homepage'],
          'cart-regression-introduced': ['homepage', 'cart'],
          'good-unrelated-commit-two': ['homepage', 'cart'],
          'known-bad': ['homepage', 'cart'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: homepage, commit: 'homepage-regression-introduced' },
        { regression: cart, commit: 'cart-regression-introduced' },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'homepage-regression-confirmed',
        // Native Git selects the side commits used to close each split group.
        'good-unrelated-commit-two',
        'cart-regression-introduced',
        'good-unrelated-commit-one',
        'homepage-regression-introduced',
      ]);
      expect(harness.candidateComparisonCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
        }),
        expect.objectContaining({
          tests: [{ testFile: 'tests/cart.abtest.ts', testName: 'Cart' }],
        }),
      ]));
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good ------------> mainline-before-merge ------> merge-topic-branch
   *  \                                                    /
   *   -> topic-first-commit -> topic-second-commit ---------
   *      ^ source first bad                                ^ primary first bad is merge
   * -> good-unrelated-commit-one -> good-unrelated-commit-two -> known-bad
   *    ^ skipped                     ^ skipped
   *
   * First run: primary only. Resume: investigate the merge source without repeating primary work.
   */
  it('resumes a completed primary run to investigate a merged regression source', async () => {
    const fixture = createMergeFixture([
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'known-bad',
    ]);
    try {
      const performance = stubRegression('performance', 'perf');
      const resultsBySha = regressionTimeline(fixture, [performance], {
        'known-good': [],
        'mainline-before-merge': [],
        'topic-first-commit': ['performance'],
        'topic-second-commit': ['performance'],
        'merge-topic-branch': ['performance'],
        'good-unrelated-commit-one': ['performance'],
        'good-unrelated-commit-two': ['performance'],
        'known-bad': ['performance'],
      });
      const primaryHarness = createE2eDependencies({
        fixture,
        resultsBySha,
      });

      const primarySession = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['perf'],
        investigateMerges: false,
        dependencies: primaryHarness.dependencies,
      });

      expectFirstBadCommits(primarySession, fixture, [
        { regression: performance, commit: 'merge-topic-branch' },
      ]);
      const primaryTarget = primarySession.primary.targets[0]!;
      expect(primarySession.mergeInvestigations[fixture.shas['merge-topic-branch']!])
        .toMatchObject({
          status: 'merge-uninvestigated',
          targetResults: {
            [primaryTarget.id]: { kind: 'merge-uninvestigated' },
          },
        });
      expectBinarySearchTraversal(primaryHarness, fixture, [
        'known-bad',
        'merge-topic-branch',
        'mainline-before-merge',
      ]);
      expectCommitsSkippedByBinarySearch(primaryHarness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);

      const resumeHarness = createE2eDependencies({ fixture, resultsBySha });
      const resumedSession = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['perf'],
        resume: true,
        investigateMerges: true,
        dependencies: resumeHarness.dependencies,
      });

      expectFirstBadCommits(resumedSession, fixture, [
        { regression: performance, commit: 'merge-topic-branch' },
      ]);
      expectMergeAttributions(resumedSession, fixture, 'merge-topic-branch', [
        { regression: performance, sourceCommit: 'topic-first-commit' },
      ]);
      expectBinarySearchTraversal(resumeHarness, fixture, [
        'topic-second-commit',
        'topic-first-commit',
      ]);
      expectCommitsSkippedByBinarySearch(resumeHarness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good ------------> mainline-before-merge ------> merge-topic-branch
   *  \                                                    /
   *   -> topic-first-commit -> topic-second-commit -------
   *                                                        ^ regression starts at merge
   * -> good-unrelated-commit-one -> good-unrelated-commit-two -> known-bad
   *    ^ skipped                     ^ skipped
   *
   * First run: merge validation fails. Resume: retry only merge validation.
   */
  it('resumes an interrupted merge investigation and classifies merge-introduced regression', async () => {
    const fixture = createMergeFixture([
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'known-bad',
    ]);
    try {
      const visual = stubRegression('visual', 'visreg');
      const resultsBySha = regressionTimeline(fixture, [visual], {
        'known-good': [],
        'mainline-before-merge': [],
        'topic-first-commit': [],
        'topic-second-commit': [],
        'merge-topic-branch': ['visual'],
        'good-unrelated-commit-one': ['visual'],
        'good-unrelated-commit-two': ['visual'],
        'known-bad': ['visual'],
      });
      const interruptedHarness = createE2eDependencies({
        fixture,
        resultsBySha,
        failAtSha: fixture.shas['topic-second-commit'],
      });

      await expect(runBisect({
        ...fixture.runOptions,
        investigateMerges: true,
        dependencies: interruptedHarness.dependencies,
      })).rejects.toThrow(/stubbed compare failure/i);

      expect(readPersistedSession(fixture)).toMatchObject({
        status: 'failed',
        mode: 'merge-investigation',
      });
      expectBinarySearchTraversal(interruptedHarness, fixture, [
        'known-bad',
        'merge-topic-branch',
        'mainline-before-merge',
        'topic-second-commit',
      ]);
      assertExperimentRestored(fixture);

      const resumeHarness = createE2eDependencies({ fixture, resultsBySha });
      const resumedSession = await runBisect({
        ...fixture.runOptions,
        resume: true,
        investigateMerges: true,
        dependencies: resumeHarness.dependencies,
      });

      expectFirstBadCommits(resumedSession, fixture, [
        { regression: visual, commit: 'merge-topic-branch' },
      ]);
      expectMergeAttributions(resumedSession, fixture, 'merge-topic-branch', [
        { regression: visual, sourceCommit: null },
      ]);
      expectBinarySearchTraversal(resumeHarness, fixture, [
        'topic-second-commit',
      ]);
      expectCommitsSkippedByBinarySearch(resumeHarness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> good-unrelated-commit-one -> good-unrelated-commit-two
   *  \              ^ skipped                    ^ skipped
   *   \-> topic-first-commit -> topic-second-commit ----------------------\
   *      ^ source visual       ^ source accessibility
   * -> mainline-before-merge --------------------------------> merge-topic-branch
   *                                                            /
   * -> post-merge-clean-commit -> mainline-performance-regression-introduced -> known-bad
   *                               ^ regression outside merge
   */
  it('finds multiple source commits inside a merge and a later mainline regression', async () => {
    const fixture = createMergeFixture(
      [
        'post-merge-clean-commit',
        'mainline-performance-regression-introduced',
        'known-bad',
      ],
      ['good-unrelated-commit-one', 'good-unrelated-commit-two'],
    );
    try {
      const visual = stubRegression('homepage-visual', 'visreg');
      const accessibility = stubRegression('checkout-accessibility', 'accessibility', {
        testFile: 'tests/checkout.abtest.ts',
        testName: 'Checkout',
      });
      const performance = stubRegression('performance', 'perf', {
        testFile: 'tests/performance.abtest.ts',
        testName: 'Performance',
      });
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual, accessibility, performance], {
          'known-good': [],
          'good-unrelated-commit-one': [],
          'good-unrelated-commit-two': [],
          'mainline-before-merge': [],
          'topic-first-commit': ['homepage-visual'],
          'topic-second-commit': ['homepage-visual', 'checkout-accessibility'],
          'merge-topic-branch': ['homepage-visual', 'checkout-accessibility'],
          'post-merge-clean-commit': ['homepage-visual', 'checkout-accessibility'],
          'mainline-performance-regression-introduced': [
            'homepage-visual',
            'checkout-accessibility',
            'performance',
          ],
          'known-bad': ['homepage-visual', 'checkout-accessibility', 'performance'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf', 'accessibility'],
        investigateMerges: true,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'merge-topic-branch' },
        { regression: accessibility, commit: 'merge-topic-branch' },
        { regression: performance, commit: 'mainline-performance-regression-introduced' },
      ]);
      expectMergeAttributions(session, fixture, 'merge-topic-branch', [
        { regression: visual, sourceCommit: 'topic-first-commit' },
        { regression: accessibility, sourceCommit: 'topic-second-commit' },
      ]);
      expect(session.mergeQueue).toEqual([fixture.shas['merge-topic-branch']]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'mainline-before-merge',
        'post-merge-clean-commit',
        'merge-topic-branch',
        'mainline-performance-regression-introduced',
        'topic-second-commit',
        'topic-first-commit',
      ]);
      expectCommitsSkippedByBinarySearch(harness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      expect(harness.candidateComparisonCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          categories: ['perf'],
          tests: [{
            testFile: 'tests/performance.abtest.ts',
            testName: 'Performance',
          }],
        }),
      ]));
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> good-unrelated-commit-one -> clean-before-failure
   *                 ^ skipped
   * -> good-unrelated-commit-traversed -> compare-failure
   *    ^ traversed good commit
   * -> good-unrelated-commit-two -> known-bad
   *    ^ skipped
   *
   * First run: midpoint comparison fails. Resume: retry that midpoint without merge work.
   */
  it('resumes an interrupted primary search without merge investigations', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'good-unrelated-commit-one',
      'clean-before-failure',
      'good-unrelated-commit-traversed',
      'compare-failure',
      'good-unrelated-commit-two',
      'known-bad',
    ]);
    try {
      const visual = stubRegression('visual', 'visreg');
      const resultsBySha = visregTimeline(fixture, {
        'known-good': false,
        'good-unrelated-commit-one': false,
        'clean-before-failure': false,
        'good-unrelated-commit-traversed': false,
        'compare-failure': true,
        'good-unrelated-commit-two': true,
        'known-bad': true,
      });
      const interruptedHarness = createE2eDependencies({
        fixture,
        resultsBySha,
        failAtSha: fixture.shas['compare-failure'],
      });

      await expect(runBisect({
        ...fixture.runOptions,
        investigateMerges: false,
        dependencies: interruptedHarness.dependencies,
      })).rejects.toThrow(/stubbed compare failure/i);

      expect(readPersistedSession(fixture)).toMatchObject({
        status: 'failed',
        failure: expect.stringMatching(/stubbed compare failure/i),
      });
      expectBinarySearchTraversal(interruptedHarness, fixture, [
        'known-bad',
        'good-unrelated-commit-traversed',
        // Native Git owns the candidate sequence for the narrowed range.
        'good-unrelated-commit-two',
        'compare-failure',
      ]);
      expectCommitsSkippedByBinarySearch(interruptedHarness, fixture, [
        'good-unrelated-commit-one',
      ]);
      assertExperimentRestored(fixture);

      const resumeHarness = createE2eDependencies({ fixture, resultsBySha });
      const resumedSession = await runBisect({
        ...fixture.runOptions,
        resume: true,
        investigateMerges: false,
        dependencies: resumeHarness.dependencies,
      });

      expect(resumedSession.status).toBe('complete');
      expectFirstBadCommits(resumedSession, fixture, [
        { regression: visual, commit: 'compare-failure' },
      ]);
      expectBinarySearchTraversal(resumeHarness, fixture, ['compare-failure']);
      expectCommitsSkippedByBinarySearch(resumeHarness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> good-unrelated-commit-one -> command-rebuild-fails
   *                 ^ skipped                    ^ traversed; falls back to container rebuild
   * -> visual-regression-introduced -> regression-confirmed -> known-bad
   *    ^ first bad
   */
  it('falls back to a container rebuild when command rebuilding fails', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'good-unrelated-commit-one',
      'command-rebuild-fails',
      'visual-regression-introduced',
      'regression-confirmed',
      'known-bad',
    ]);
    const visual = stubRegression('visual', 'visreg');
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'good-unrelated-commit-one': false,
          'command-rebuild-fails': false,
          'visual-regression-introduced': true,
          'regression-confirmed': true,
          'known-bad': true,
        }),
        containerFallbackAtSha: fixture.shas['command-rebuild-fails'],
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'visual-regression-introduced' },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'command-rebuild-fails',
        // Native Git tests this candidate before closing the bad boundary.
        'regression-confirmed',
        'visual-regression-introduced',
      ]);
      expect(harness.experimentReloadCalls).toContainEqual({
        sha: fixture.shas['command-rebuild-fails'],
        preferredExperimentReloadMode: 'commands',
      });
      expect(session.commitRuns[fixture.shas['command-rebuild-fails']!]).toMatchObject({
        compareCompleted: true,
        experimentReloadMode: 'container',
        usedFallback: true,
      });
      expectCommitsSkippedByBinarySearch(harness, fixture, [
        'good-unrelated-commit-one',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> clean-midpoint-one -> good-unrelated-commit-one
   *                                      ^ skipped
   * -> clean-midpoint-two -> good-unrelated-commit-two -> known-bad-clean
   *                          ^ skipped
   */
  it('completes without midpoint work when the bad ref has no regressions', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'clean-midpoint-one',
      'good-unrelated-commit-one',
      'clean-midpoint-two',
      'good-unrelated-commit-two',
      'known-bad-clean',
    ]);
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'clean-midpoint-one': false,
          'good-unrelated-commit-one': false,
          'clean-midpoint-two': false,
          'good-unrelated-commit-two': false,
          'known-bad-clean': false,
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expect(session.status).toBe('complete');
      expect(session.primary.targets).toEqual([]);
      expectBinarySearchTraversal(harness, fixture, ['known-bad-clean']);
      expectCommitsSkippedByBinarySearch(harness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> visual-regression-introduced -> regression-confirmed
   *                 ^ first bad
   * -> good-unrelated-commit-one -> good-unrelated-commit-two -> known-bad
   *    ^ skipped                     ^ skipped
   */
  it('finds a first bad commit immediately adjacent to good', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'visual-regression-introduced',
      'regression-confirmed',
      'good-unrelated-commit-one',
      'good-unrelated-commit-two',
      'known-bad',
    ]);
    const visual = stubRegression('visual', 'visreg');
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'visual-regression-introduced': true,
          'regression-confirmed': true,
          'good-unrelated-commit-one': true,
          'good-unrelated-commit-two': true,
          'known-bad': true,
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'visual-regression-introduced' },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'regression-confirmed',
        'visual-regression-introduced',
      ]);
      expectCommitsSkippedByBinarySearch(harness, fixture, [
        'good-unrelated-commit-one',
        'good-unrelated-commit-two',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  it('applies missing-test, build, overlapping, and data repairs without leaking state', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'older-without-test',
      'regression-introduced',
      'build-incompatible',
      'regression-confirmed',
      'known-bad',
    ]);
    const repairSha = fixture.shas['regression-introduced']!;
    const seedPath = path.join(fixture.rootDir, 'experiment-seed-state');
    try {
      configureRepairs(fixture, [
        repair(fixture, {
          id: 'backport-frozen-test',
          kind: 'test-harness',
          purpose: 'Supply the frozen test on older candidates',
          patch: newFilePatch('tests/frozen.abtest.ts', 'frozen test\n'),
          appliesTo: { commits: [fixture.shas['older-without-test']!, repairSha] },
        }),
        repair(fixture, {
          id: 'historical-build-fix',
          kind: 'build',
          purpose: 'Repair the historical build interval',
          patch: newFilePatch('build-compatibility.txt', 'compatible\n'),
          appliesTo: {
            from: repairSha,
            through: fixture.shas['build-incompatible']!,
          },
        }),
        repair(fixture, {
          id: 'ordered-base',
          purpose: 'Create the base consumed by the following repair',
          patch: newFilePatch('repair-order.txt', 'first\n'),
          appliesTo: { commits: [repairSha] },
        }),
        repair(fixture, {
          id: 'ordered-extension',
          purpose: 'Extend the base from the preceding repair',
          patch: appendLinePatch('repair-order.txt', 'first', 'second'),
          appliesTo: { commits: [repairSha] },
        }),
        repair(fixture, {
          id: 'seed-data',
          kind: 'data',
          purpose: 'Prepare candidate-specific seed data',
          patch: newFilePatch('seed-repair.txt', 'seed repair\n'),
          appliesTo: { commits: [repairSha] },
          prepareCommands: [{ description: 'Seed data', command: 'seed-fixture' }],
          cleanupCommands: [{ description: 'Remove seed data', command: 'unseed-fixture' }],
        }),
      ]);

      const observedUnpatchedCandidates: string[] = [];
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'older-without-test': false,
          'regression-introduced': true,
          'build-incompatible': true,
          'regression-confirmed': true,
          'known-bad': true,
        }),
        onRefresh(request) {
          const experiment = fixture.experimentDir;
          if (request.sha === repairSha) {
            expect(fs.readFileSync(path.join(experiment, 'tests/frozen.abtest.ts'), 'utf8'))
              .toBe('frozen test\n');
            expect(fs.readFileSync(path.join(experiment, 'build-compatibility.txt'), 'utf8'))
              .toBe('compatible\n');
            expect(fs.readFileSync(path.join(experiment, 'repair-order.txt'), 'utf8'))
              .toBe('first\nsecond\n');
          } else {
            observedUnpatchedCandidates.push(request.sha);
            expect(fs.existsSync(path.join(experiment, 'repair-order.txt'))).toBe(false);
            expect(fs.existsSync(seedPath)).toBe(false);
          }
        },
        onRepairCommands(call) {
          if (call.commands.includes('seed-fixture')) fs.writeFileSync(seedPath, 'seeded\n');
          if (call.commands.includes('unseed-fixture')) fs.rmSync(seedPath, { force: true });
        },
        onCompare(request) {
          if (request.sha === repairSha) expect(fs.readFileSync(seedPath, 'utf8')).toBe('seeded\n');
        },
      });

      const session = await runBisect({ ...fixture.runOptions, dependencies: harness.dependencies });

      expectFirstBadCommits(session, fixture, [{
        regression: stubRegression('visual', 'visreg'),
        commit: 'regression-introduced',
      }]);
      expect(harness.repairCommandCalls.filter((call) => call.sha === repairSha))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ phase: 'prepare', commands: ['seed-fixture'] }),
          expect.objectContaining({ phase: 'cleanup', commands: ['unseed-fixture'] }),
        ]));
      expect(observedUnpatchedCandidates.length).toBeGreaterThan(0);
      expect(fs.existsSync(seedPath)).toBe(false);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  it('selects repairs by SHA during merge endpoint and child measurements', async () => {
    const fixture = createMergeFixture(['known-bad']);
    const mergeShas: [string, string] = [
      fixture.shas['topic-second-commit']!,
      fixture.shas['topic-first-commit']!,
    ];
    try {
      configureRepairs(fixture, [repair(fixture, {
        id: 'topic-compatibility',
        kind: 'build',
        purpose: 'Build topic commits during merge investigation',
        patch: newFilePatch('topic-compatibility.txt', 'topic compatible\n'),
        appliesTo: { commits: mergeShas },
      })]);
      const visual = stubRegression('visual', 'visreg');
      const observed = new Set<string>();
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual], {
          'known-good': [],
          'mainline-before-merge': [],
          'topic-first-commit': ['visual'],
          'topic-second-commit': ['visual'],
          'merge-topic-branch': ['visual'],
          'known-bad': ['visual'],
        }),
        onCompare(request) {
          if (mergeShas.includes(request.sha)) {
            expect(fs.readFileSync(
              path.join(fixture.experimentDir, 'topic-compatibility.txt'),
              'utf8',
            )).toBe('topic compatible\n');
            observed.add(request.sha);
          }
        },
      });

      await runBisect({
        ...fixture.runOptions,
        investigateMerges: true,
        dependencies: harness.dependencies,
      });

      expect(observed).toEqual(new Set(mergeShas));
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  it('withholds a native verdict when repair cleanup fails', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'clean-before-failure',
      'cleanup-failure',
      'regression-confirmed',
      'known-bad',
    ]);
    const failureSha = fixture.shas['cleanup-failure']!;
    try {
      configureRepairs(fixture, [repair(fixture, {
        id: 'cleanup-failure',
        purpose: 'Exercise transactional cleanup failure',
        patch: newFilePatch('cleanup-marker.txt', 'patched\n'),
        appliesTo: { commits: [failureSha] },
        cleanupCommands: [{ description: 'Fail cleanup', command: 'fail-cleanup' }],
      })]);
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'clean-before-failure': false,
          'cleanup-failure': true,
          'regression-confirmed': true,
          'known-bad': true,
        }),
        onRepairCommands(call) {
          if (call.phase === 'cleanup' && call.commands.includes('fail-cleanup')) {
            throw new Error('stubbed repair cleanup failure');
          }
        },
      });

      await expect(runBisect({ ...fixture.runOptions, dependencies: harness.dependencies }))
        .rejects.toThrow(/stubbed repair cleanup failure/i);

      const failed = readPersistedSession(fixture);
      expect(failed.status).toBe('failed');
      expect(failed.primary.groups.flatMap((group) => group.decisions))
        .not.toContainEqual(expect.objectContaining({ sha: failureSha }));
      expect([...failed.primary.attempts].reverse().find((attempt) => attempt.sha === failureSha))
        .toMatchObject({
        status: 'incomplete',
        repairEvidence: {
          applications: [expect.objectContaining({ cleanup: 'failed' })],
        },
      });
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  it('resumes with the persisted patch after its configured source is removed', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'clean-before-repair',
      'repaired-candidate',
      'regression-confirmed',
      'known-bad',
    ]);
    const repairedSha = fixture.shas['repaired-candidate']!;
    try {
      const configured = repair(fixture, {
        id: 'resume-repair',
        purpose: 'Persist a repair across interruption',
        patch: newFilePatch('resume-marker.txt', 'persisted repair\n'),
        appliesTo: { commits: [repairedSha] },
      });
      configureRepairs(fixture, [configured]);
      const resultsBySha = visregTimeline(fixture, {
        'known-good': false,
        'clean-before-repair': false,
        'repaired-candidate': true,
        'regression-confirmed': true,
        'known-bad': true,
      });
      const interrupted = createE2eDependencies({
        fixture,
        resultsBySha,
        failAtSha: repairedSha,
        onCompare(request) {
          if (request.sha === repairedSha) {
            expect(fs.existsSync(path.join(fixture.experimentDir, 'resume-marker.txt'))).toBe(true);
          }
        },
      });
      await expect(runBisect({ ...fixture.runOptions, dependencies: interrupted.dependencies }))
        .rejects.toThrow(/stubbed compare failure/i);
      assertExperimentRestored(fixture);
      fs.rmSync(path.resolve(fixture.rootDir, configured.patch));

      const observedHashes: string[] = [];
      const resumedHarness = createE2eDependencies({
        fixture,
        resultsBySha,
        onCompare(request) {
          if (request.sha === repairedSha) {
            expect(fs.readFileSync(
              path.join(fixture.experimentDir, 'resume-marker.txt'),
              'utf8',
            )).toBe('persisted repair\n');
            observedHashes.push(readPersistedSession(fixture).repairs[0]!.sha256);
          }
        },
      });
      const resumed = await runBisect({
        ...fixture.runOptions,
        resume: true,
        dependencies: resumedHarness.dependencies,
      });

      expect(resumed.status).toBe('complete');
      expect(observedHashes).toEqual([resumed.repairs[0]!.sha256]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });
});

function expectCommitsSkippedByBinarySearch(
  harness: E2eDependencyHarness,
  fixture: E2eRepositoryFixture,
  commitLabels: readonly string[],
): void {
  const traversedShas = harness.candidateComparisonCalls.map((call) => call.sha);
  for (const label of commitLabels) {
    expect(traversedShas).not.toContain(fixture.shas[label]);
  }
}

function configureRepairs(
  fixture: E2eRepositoryFixture,
  repairs: BisectRepairConfig[],
): void {
  fixture.runOptions.config.bisect.repairs = repairs;
}

function repair(
  fixture: E2eRepositoryFixture,
  options: Pick<BisectRepairConfig, 'id' | 'purpose' | 'appliesTo'> & {
    patch: string;
    kind?: BisectRepairConfig['kind'];
    prepareCommands?: BisectRepairConfig['prepareCommands'];
    cleanupCommands?: BisectRepairConfig['cleanupCommands'];
  },
): BisectRepairConfig {
  const patchDirectory = path.join(fixture.rootDir, 'repair-sources');
  fs.mkdirSync(patchDirectory, { recursive: true });
  const patchPath = path.join(patchDirectory, `${options.id}.patch`);
  fs.writeFileSync(patchPath, options.patch, 'utf8');
  return {
    id: options.id,
    purpose: options.purpose,
    appliesTo: options.appliesTo,
    kind: options.kind ?? 'other',
    prepareCommands: options.prepareCommands ?? [],
    cleanupCommands: options.cleanupCommands ?? [],
    patch: path.relative(fixture.rootDir, patchPath),
  };
}

function newFilePatch(filename: string, contents: string): string {
  const added = contents.split('\n').slice(0, -1).map((line) => `+${line}`).join('\n');
  const lineCount = contents.split('\n').length - 1;
  return [
    `diff --git a/${filename} b/${filename}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filename}`,
    `@@ -0,0 +1,${lineCount} @@`,
    added,
    '',
  ].join('\n');
}

function appendLinePatch(filename: string, existing: string, addition: string): string {
  return [
    `diff --git a/${filename} b/${filename}`,
    `--- a/${filename}`,
    `+++ b/${filename}`,
    '@@ -1 +1,2 @@',
    ` ${existing}`,
    `+${addition}`,
    '',
  ].join('\n');
}
