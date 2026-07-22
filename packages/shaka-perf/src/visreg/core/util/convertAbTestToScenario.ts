/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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

// The per-test surface is flat and small: capture targets (`selectors`,
// `selectorExpansion`) at the top level. Interactions, ready-waits, and DOM
// manipulation live in the test body. Comparison thresholds default from the
// engine-bridge config; a test's `config.visreg` override wins per-scenario.
export function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string,
  urls?: ScenarioUrls,
): Scenario {
  const experimentPath = testDef.experimentPathOverride ?? testDef.startingPath;
  const scenario: Scenario = {
    label: testDef.name,
    url: urls?.experimentURL ?? resolveUrl(experimentPath, experimentURL),
    referenceUrl: urls?.controlURL ?? resolveUrl(testDef.startingPath, controlURL),
    selectors: testDef.visregSelectors ?? ['document'],
    _testFn: testDef.testFn,
    _testDef: testDef,
  };

  // Only set optional properties when they have a value to avoid _.has()
  // returning true for undefined values (which causes .map() crashes in
  // preparePage).
  if (testDef.visregSelectorExpansion != null) scenario.selectorExpansion = testDef.visregSelectorExpansion;

  // Per-test comparison tuning is NOT copied onto the scenario: the engine
  // resolves it from the effective config (file defaults + `test.config.visreg`)
  // via `visregConfigForTest`, reading `scenario._testDef` — the same per-test
  // overlay accessibility uses. The scenario carries no tuning fields.
  return scenario;
}
