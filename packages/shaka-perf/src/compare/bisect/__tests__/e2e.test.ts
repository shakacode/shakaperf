/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { runBisect } from '../session';
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

describe('compare bisect black-box E2E', () => {
  /*
   * known-good -> visual-regression-introduced -> visual-regression-confirmed
   *                 ^ first visual
   * -> performance-regression-introduced -> visual-and-performance-confirmed
   *    ^ first performance
   * -> accessibility-regression-introduced -> known-bad
   *    ^ first accessibility
   */
  it('finds different regression types at their independent first bad commits', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'visual-regression-introduced',
      'visual-regression-confirmed',
      'performance-regression-introduced',
      'visual-and-performance-confirmed',
      'accessibility-regression-introduced',
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
          'visual-regression-confirmed': ['visual'],
          'performance-regression-introduced': ['visual', 'performance'],
          'visual-and-performance-confirmed': ['visual', 'performance'],
          'accessibility-regression-introduced': ['visual', 'performance', 'accessibility'],
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
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'performance-regression-introduced',
        'visual-regression-introduced',
        'visual-regression-confirmed',
        'visual-and-performance-confirmed',
        'accessibility-regression-introduced',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> clean-before-regressions -> visual-and-performance-regressions-introduced
   *                                           ^ first visual/performance
   * -> regressions-confirmed -> known-bad
   */
  it('finds multiple regressions introduced by one commit with shared candidate work', async () => {
    const fixture = createLinearFixture([
      'known-good',
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
        'visual-and-performance-regressions-introduced',
        'clean-before-regressions',
      ]);
      expect(harness.compareCalls.filter((call) => (
        call.sha === fixture.shas['visual-and-performance-regressions-introduced']
      ))).toHaveLength(1);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> homepage-regression-introduced -> homepage-regression-confirmed
   *                 ^ first homepage
   * -> cart-regression-introduced -> known-bad
   *    ^ first cart
   */
  it('narrows different exact tests in one category to separate first bad commits', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'homepage-regression-introduced',
      'homepage-regression-confirmed',
      'cart-regression-introduced',
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
          'homepage-regression-confirmed': ['homepage'],
          'cart-regression-introduced': ['homepage', 'cart'],
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
        'cart-regression-introduced',
        'homepage-regression-introduced',
      ]);
      expect(harness.compareCalls).toEqual(expect.arrayContaining([
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
   * known-good ------------> mainline-before-merge ------> merge-topic-branch -> known-bad
   *  \                                                    /
   *   -> topic-first-commit -> topic-second-commit ---------
   *      ^ source first bad                                ^ primary first bad is merge
   */
  it('finds a regression on a merged branch after locating the primary merge', async () => {
    const fixture = createMergeFixture(['known-bad']);
    try {
      const performance = stubRegression('performance', 'perf');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [performance], {
          'known-good': [],
          'mainline-before-merge': [],
          'topic-first-commit': ['performance'],
          'topic-second-commit': ['performance'],
          'merge-topic-branch': ['performance'],
          'known-bad': ['performance'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['perf'],
        investigateMerges: true,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: performance, commit: 'merge-topic-branch' },
      ]);
      expectMergeAttributions(session, fixture, 'merge-topic-branch', [
        { regression: performance, sourceCommit: 'topic-first-commit' },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'mainline-before-merge',
        'merge-topic-branch',
        'topic-second-commit',
        'topic-first-commit',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good ------------> mainline-before-merge ------> merge-topic-branch -> known-bad
   *  \                                                    /
   *   -> topic-first-commit -> topic-second-commit -------
   *                                                        ^ regression starts at merge
   */
  it('classifies a regression created by merge resolution as merge introduced', async () => {
    const fixture = createMergeFixture(['known-bad']);
    try {
      const visual = stubRegression('visual', 'visreg');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual], {
          'known-good': [],
          'mainline-before-merge': [],
          'topic-first-commit': [],
          'topic-second-commit': [],
          'merge-topic-branch': ['visual'],
          'known-bad': ['visual'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        investigateMerges: true,
        dependencies: harness.dependencies,
      });

      expectFirstBadCommits(session, fixture, [
        { regression: visual, commit: 'merge-topic-branch' },
      ]);
      expectMergeAttributions(session, fixture, 'merge-topic-branch', [
        { regression: visual, sourceCommit: null },
      ]);
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'mainline-before-merge',
        'merge-topic-branch',
        'topic-second-commit',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good ------------> mainline-before-merge ------> merge-topic-branch
   *  \                                                    /
   *   -> topic-first-commit -> topic-second-commit ---------
   *      ^ source visual       ^ source accessibility
   * -> post-merge-clean-commit -> mainline-performance-regression-introduced -> known-bad
   *                               ^ regression outside merge
   */
  it('finds multiple source commits inside a merge and a later mainline regression', async () => {
    const fixture = createMergeFixture([
      'post-merge-clean-commit',
      'mainline-performance-regression-introduced',
      'known-bad',
    ]);
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
        'merge-topic-branch',
        'mainline-before-merge',
        'post-merge-clean-commit',
        'mainline-performance-regression-introduced',
        'topic-second-commit',
        'topic-first-commit',
      ]);
      expect(harness.compareCalls).toEqual(expect.arrayContaining([
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
   * known-good -> clean-before-failure -> compare-failure -> known-bad
   */
  it('restores the experiment checkout and persists failure when compare throws', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'clean-before-failure',
      'compare-failure',
      'known-bad',
    ]);
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'clean-before-failure': false,
          'compare-failure': true,
          'known-bad': true,
        }),
        failAtSha: fixture.shas['compare-failure'],
      });

      await expect(runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      })).rejects.toThrow(/stubbed compare failure/i);

      expect(readPersistedSession(fixture)).toMatchObject({
        status: 'failed',
        failure: expect.stringMatching(/stubbed compare failure/i),
      });
      expectBinarySearchTraversal(harness, fixture, [
        'known-bad',
        'clean-before-failure',
        'compare-failure',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> clean-midpoint-one -> clean-midpoint-two -> known-bad-clean
   */
  it('completes without midpoint work when the bad ref has no regressions', async () => {
    const fixture = createLinearFixture([
      'known-good',
      'clean-midpoint-one',
      'clean-midpoint-two',
      'known-bad-clean',
    ]);
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          'known-good': false,
          'clean-midpoint-one': false,
          'clean-midpoint-two': false,
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
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * known-good -> visual-regression-introduced -> regression-confirmed -> known-bad
   *                 ^ first bad
   */
  it('finds a first bad commit immediately adjacent to good', async () => {
    const fixture = createLinearFixture([
      'known-good',
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
          'visual-regression-introduced': true,
          'regression-confirmed': true,
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
        'visual-regression-introduced',
      ]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });
});
