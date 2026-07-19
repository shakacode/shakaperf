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
  regressionTimeline,
  stubRegression,
  visregTimeline,
} from './e2e-fixture';

describe('compare bisect black-box E2E', () => {
  /*
   * G clean -> V visreg -> NV visreg -> P +perf -> NP vis+perf -> A +a11y -> BAD all
   *            ^ first V                 ^ first P                  ^ first A
   */
  it('finds different regression types at their independent first bad commits', async () => {
    const fixture = createLinearFixture(['G', 'V', 'NV', 'P', 'NP', 'A', 'BAD']);
    try {
      const visual = stubRegression('visual', 'visreg');
      const performance = stubRegression('performance', 'perf');
      const accessibility = stubRegression('accessibility', 'accessibility');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual, performance, accessibility], {
          G: [],
          V: ['visual'],
          NV: ['visual'],
          P: ['visual', 'performance'],
          NP: ['visual', 'performance'],
          A: ['visual', 'performance', 'accessibility'],
          BAD: ['visual', 'performance', 'accessibility'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf', 'accessibility'],
        dependencies: harness.dependencies,
      });

      expect(Object.fromEntries(session.primary.targets.map((target) => [
        target.category,
        target.firstBadSha,
      ]))).toEqual({
        accessibility: fixture.shas.A,
        perf: fixture.shas.P,
        visreg: fixture.shas.V,
      });
      expect(harness.compareCalls.some((call) => call.categories.length < 3)).toBe(true);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * G clean -> N clean -> VP visreg+perf -> N2 both -> BAD both
   *                       ^ first V/P
   */
  it('finds multiple regressions introduced by one commit with shared candidate work', async () => {
    const fixture = createLinearFixture(['G', 'N', 'VP', 'N2', 'BAD']);
    try {
      const visual = stubRegression('visual', 'visreg');
      const performance = stubRegression('performance', 'perf');
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: regressionTimeline(fixture, [visual, performance], {
          G: [],
          N: [],
          VP: ['visual', 'performance'],
          N2: ['visual', 'performance'],
          BAD: ['visual', 'performance'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        selectedCategories: ['visreg', 'perf'],
        dependencies: harness.dependencies,
      });

      expect(session.primary.targets.map((target) => target.firstBadSha))
        .toEqual([fixture.shas.VP, fixture.shas.VP]);
      expect(harness.compareCalls.filter((call) => call.sha === fixture.shas.VP)).toHaveLength(1);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * G clean -> H homepage -> N homepage -> C +cart -> BAD both
   *            ^ first H                  ^ first C
   */
  it('narrows different exact tests in one category to separate first bad commits', async () => {
    const fixture = createLinearFixture(['G', 'H', 'N', 'C', 'BAD']);
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
          G: [],
          H: ['homepage'],
          N: ['homepage'],
          C: ['homepage', 'cart'],
          BAD: ['homepage', 'cart'],
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expect(Object.fromEntries(session.primary.targets.map((target) => [
        target.testName,
        target.firstBadSha,
      ]))).toEqual({
        Cart: fixture.shas.C,
        Homepage: fixture.shas.H,
      });
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
   * G clean -> N1 clean -> N2 clean -> BAD clean
   */
  it('completes without midpoint work when the bad ref has no regressions', async () => {
    const fixture = createLinearFixture(['G', 'N1', 'N2', 'BAD']);
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          G: false,
          N1: false,
          N2: false,
          BAD: false,
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expect(session.status).toBe('complete');
      expect(session.primary.targets).toEqual([]);
      expect(harness.compareCalls.map((call) => call.sha)).toEqual([fixture.shas.BAD]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });

  /*
   * G clean -> V visreg -> N visreg -> BAD visreg
   *            ^ first bad
   */
  it('finds a first bad commit immediately adjacent to good', async () => {
    const fixture = createLinearFixture(['G', 'V', 'N', 'BAD']);
    try {
      const harness = createE2eDependencies({
        fixture,
        resultsBySha: visregTimeline(fixture, {
          G: false,
          V: true,
          N: true,
          BAD: true,
        }),
      });

      const session = await runBisect({
        ...fixture.runOptions,
        dependencies: harness.dependencies,
      });

      expect(session.status).toBe('complete');
      expect(session.primary.targets).toMatchObject([{
        category: 'visreg',
        status: 'found',
        firstBadSha: fixture.shas.V,
      }]);
      assertExperimentRestored(fixture);
    } finally {
      fixture.cleanup();
    }
  });
});
