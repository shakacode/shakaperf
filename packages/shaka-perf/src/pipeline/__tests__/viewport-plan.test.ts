/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import { buildAbTestsConfig } from '../../config';
import { persistedOutcomeInScope } from '../viewport-plan';
import type { Outcome } from '../outcome';
import type { Stage } from '../../stage/stage';

function makeTest(overrides: Partial<AbTestDefinition> = {}): AbTestDefinition {
  return {
    name: 'Test',
    file: '/tests/test.abtest.ts',
    line: 1,
    startingPath: '/',
    testTypes: null,
    testFn: async () => {},
    ...overrides,
  } as AbTestDefinition;
}

function makeStage(name: string, category: Stage['category']): Stage {
  return { name, category } as Stage;
}

const okOutcome = (stage: string): Outcome => ({ kind: 'ok', stage });
const skippedOutcome = (stage: string): Outcome => ({ kind: 'skipped', stage, reason: 'r' });

// Default config: shared viewports desktop/tablet/phone; visreg at all three,
// accessibility at desktop/phone.
const config = buildAbTestsConfig({
  shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 } },
});
const visregStage = makeStage('visreg', 'visreg');
const a11yStage = makeStage('accessibility', 'accessibility');

describe('persistedOutcomeInScope', () => {
  it('keeps an outcome at a viewport the category runs at', () => {
    const test = makeTest();
    expect(persistedOutcomeInScope(test, config, visregStage, okOutcome('visreg'), 'desktop')).toBe(true);
  });

  it('drops a stale outcome at a viewport the per-test override no longer runs at', () => {
    // The user's repro: config.visreg.viewports narrowed per-test, but a
    // previous run left visreg.json in the desktop/phone unit dirs.
    const test = makeTest({ config: { visreg: { viewports: ['tablet'] } } });
    expect(persistedOutcomeInScope(test, config, visregStage, okOutcome('visreg'), 'desktop')).toBe(false);
    expect(persistedOutcomeInScope(test, config, visregStage, okOutcome('visreg'), 'tablet')).toBe(true);
  });

  it('drops a stale outcome for a category the test opted out of via testTypes', () => {
    const test = makeTest({ testTypes: ['visreg'] });
    expect(persistedOutcomeInScope(test, config, a11yStage, okOutcome('accessibility'), 'desktop')).toBe(false);
  });

  it('always keeps skip markers', () => {
    const test = makeTest({
      testTypes: ['visreg'],
      config: { visreg: { viewports: ['tablet'] } },
    });
    expect(persistedOutcomeInScope(test, config, visregStage, skippedOutcome('visreg'), 'desktop')).toBe(true);
    expect(persistedOutcomeInScope(test, config, a11yStage, skippedOutcome('accessibility'), 'desktop')).toBe(true);
  });

  it('keeps outcomes for a stage the pipeline does not know', () => {
    const test = makeTest();
    expect(persistedOutcomeInScope(test, config, undefined, okOutcome('legacy-stage'), 'desktop')).toBe(true);
  });
});
