/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestPair, Scenario, Viewport, EnginePlaywrightOptions, DecoratedCompareConfig } from "../types";

// One fixed naming scheme — there is no user-facing template or output-format
// knob. PNG only; the name is stable across invocations so the crash-resumable
// frame pools (keyed by basename) survive a unit retry.
const FILENAME_TEMPLATE = '{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}';
export const OUTPUT_FORMAT_SUFFIX = '.png';

function getSelectorName (selector: string) {
  return selector.replace(/[^a-z0-9_-]/gi, ''); // remove anything that's not a letter or a number
}

function makeSafe (str: string) {
  return str.replace(/[ /]/g, '_');
}

function getFilename (scenarioLabelSafe: string, selectorIndex: number, selectorLabel: string, viewportIndex: number | undefined, viewportLabel: string) {
  const fileName = FILENAME_TEMPLATE
    .replace(/\{scenarioLabel\}/, scenarioLabelSafe)
    .replace(/\{selectorIndex\}/, String(selectorIndex))
    .replace(/\{selectorLabel\}/, selectorLabel)
    .replace(/\{viewportIndex\}/, String(viewportIndex))
    .replace(/\{viewportLabel\}/, makeSafe(viewportLabel))
    .replace(/[^a-z0-9_-]/gi, ''); // remove anything that's not a letter or a number or dash or underscore.

  return fileName + OUTPUT_FORMAT_SUFFIX;
}

function getEngineOption<T> (config: { playwrightOptions?: EnginePlaywrightOptions }, optionName: string, fallBack: T): T {
  if (typeof config.playwrightOptions === 'object' && config.playwrightOptions[optionName]) {
    return config.playwrightOptions[optionName] as T;
  }
  return fallBack;
}

function generateTestPair (config: DecoratedCompareConfig, scenario: Scenario, viewport: Viewport, scenarioLabelSafe: string, selectorIndex: number, selector: string): TestPair {
  const cleanedSelectorName = getSelectorName(selector);
  const fileName = getFilename(scenarioLabelSafe, selectorIndex, cleanedSelectorName, viewport.vIndex, viewport.label);

  const testPair: TestPair = {
    reference: config.env.controlScreenshotDir + '/' + fileName,
    test: config.env.experimentScreenshotDir + '/' + fileName,
    selector,
    fileName,
    label: scenario.label,
    mismatchThreshold: config.mismatchThreshold,
    url: scenario.url,
    referenceUrl: scenario.referenceUrl,
    viewportLabel: viewport.label
  };

  if (scenario._testDef) {
    if (scenario._testDef.file) testPair.testFile = scenario._testDef.file;
    if (scenario._testDef.line != null) testPair.testLine = scenario._testDef.line;
  }

  return testPair;
}

export {
  generateTestPair,
  makeSafe,
  getFilename,
  getEngineOption,
  getSelectorName
};
