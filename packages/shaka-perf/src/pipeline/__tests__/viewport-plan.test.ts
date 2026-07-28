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
import { persistedOutcomeInScope, viewportsForTestAcrossStages } from '../viewport-plan';
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

describe('viewportsForTestAcrossStages', () => {
  const auditStage = makeStage('audit', 'audit');
  const labels = (test: AbTestDefinition, stages: Stage[]) =>
    viewportsForTestAcrossStages(test, stages, config).map((viewport) => viewport.label);

  it('unions the viewports of every category the test runs', () => {
    // visreg narrowed to tablet, accessibility left on the shared default.
    const test = makeTest({ config: { visreg: { viewports: ['tablet'] } } });
    expect(labels(test, [visregStage, a11yStage]).sort()).toEqual(['desktop', 'phone', 'tablet']);
  });

  it('ignores viewports of a category the test opted out of via testTypes', () => {
    // The audit-report repro: `testTypes: ['visreg']` is widened to
    // ['visreg', 'audit'] by withMandatoryTestTypes, so audit runs and
    // accessibility does not. Audit is pinned to desktop, so the test has no
    // phone work at all — accessibility's shared desktop + phone default must
    // not put a phone row back, or the phone-framed client report renders it
    // as a page it "couldn't measure".
    const test = makeTest({
      testTypes: ['visreg', 'audit'],
      config: { visreg: { viewports: ['desktop'] }, audit: { viewports: ['desktop'] } },
    });
    expect(labels(test, [auditStage, a11yStage])).toEqual(['desktop']);
  });

  it('keeps that category once the test declares it', () => {
    const test = makeTest({
      testTypes: ['visreg', 'audit', 'accessibility'],
      config: { visreg: { viewports: ['desktop'] }, audit: { viewports: ['desktop'] } },
    });
    expect(labels(test, [auditStage, a11yStage]).sort()).toEqual(['desktop', 'phone']);
  });
});
