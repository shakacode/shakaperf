/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { Scenario } from '../types';
import { resolveUrl } from '../../../pipeline/unit-urls';

export interface ScenarioUrls {
  readonly controlURL: string;
  readonly experimentURL: string;
}

// The per-test surface is flat and small: the capture targets (`selectors`)
// at the top level. Interactions, ready-waits, and DOM manipulation live in
// the test body. Comparison thresholds default from the engine-bridge config;
// a test's `config.visreg` override wins per-scenario.
export function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string,
  urls?: ScenarioUrls,
): Scenario {
  const experimentPath = testDef.experimentPathOverride ?? testDef.startingPath;
  // Per-test comparison tuning is NOT copied onto the scenario: the compare
  // stage writes the effective values (file defaults + `test.config.visreg`)
  // into the engine's bridge config. The scenario carries no tuning fields.
  return {
    label: testDef.name,
    url: urls?.experimentURL ?? resolveUrl(experimentPath, experimentURL),
    referenceUrl: urls?.controlURL ?? resolveUrl(testDef.startingPath, controlURL),
    selectors: testDef.visregSelectors ?? ['document'],
    _testFn: testDef.testFn,
    _testDef: testDef,
  };
}
