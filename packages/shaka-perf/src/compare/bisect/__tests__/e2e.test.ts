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
  visregTimeline,
} from './e2e-fixture';

describe('compare bisect black-box E2E', () => {
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
