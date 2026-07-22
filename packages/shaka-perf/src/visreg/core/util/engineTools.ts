/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestPair, Scenario, Viewport, RuntimeConfig, EngineOptions, DecoratedCompareConfig } from "../types";

function ensureFileSuffix (filename: string, suffix: string) {
  const re = new RegExp('\.' + suffix + '$', ''); // eslint-disable-line no-useless-escape
  return filename.replace(re, '') + '.' + suffix;
}

// merge both strings while soft-enforcing a single slash between them
function glueStringsWithSlash (stringA: string, stringB: string) {
  return stringA.replace(/\/$/, '') + '/' + stringB.replace(/^\//, '');
}

function genHash (str: unknown) {
  let hash = 0;
  let i;
  let chr;
  let len;
  if (!str) return String(hash);
  const s = String(str);
  for (i = 0, len = s.length; i < len; i++) {
    chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  // return a string and replace a negative sign with a zero
  return hash.toString().replace(/^-/, '0');
}

function getSelectorName (selector: string) {
  return selector.replace(/[^a-z0-9_-]/gi, ''); // remove anything that's not a letter or a number
}

function makeSafe (str: string) {
  return str.replace(/[ /]/g, '_');
}

function getFilename (fileNameTemplate: string, outputFileFormatSuffix: string, configId: string, scenarioIndex: number | undefined, scenarioLabelSafe: string, selectorIndex: number, selectorLabel: string, viewportIndex: number | undefined, viewportLabel: string) {
  let fileName = fileNameTemplate
    .replace(/\{configId\}/, configId)
    .replace(/\{scenarioIndex\}/, String(scenarioIndex))
    .replace(/\{scenarioLabel\}/, scenarioLabelSafe)
    .replace(/\{selectorIndex\}/, String(selectorIndex))
    .replace(/\{selectorLabel\}/, selectorLabel)
    .replace(/\{viewportIndex\}/, String(viewportIndex))
    .replace(/\{viewportLabel\}/, makeSafe(viewportLabel))
    .replace(/[^a-z0-9_-]/gi, ''); // remove anything that's not a letter or a number or dash or underscore.

  const extRegExp = new RegExp(outputFileFormatSuffix + '$', 'i');
  if (!extRegExp.test(fileName)) {
    fileName = fileName + outputFileFormatSuffix;
  }
  return fileName;
}

function getEngineOption<T> (config: { engineOptions?: EngineOptions }, optionName: string, fallBack: T): T {
  if (typeof config.engineOptions === 'object' && config.engineOptions[optionName]) {
    return config.engineOptions[optionName] as T;
  }
  return fallBack;
}

function getScenarioExpect (scenario: Scenario & { expect?: number }) {
  let expect = 0;
  if (scenario.selectorExpansion && scenario.selectors && scenario.selectors.length && scenario.expect) {
    expect = scenario.expect;
  }

  return expect;
}

function generateTestPair (config: DecoratedCompareConfig, scenario: Scenario, viewport: Viewport, variantOrScenarioLabelSafe: string, scenarioLabelSafe: string, selectorIndex: number, selector: string): TestPair {
  const cleanedSelectorName = getSelectorName(selector);
  const fileName = getFilename(
    config._fileNameTemplate,
    config._outputFileFormatSuffix,
    config._configId,
    scenario.sIndex,
    variantOrScenarioLabelSafe,
    selectorIndex,
    cleanedSelectorName,
    viewport.vIndex,
    viewport.label
  );
  const testFilePath = config._experimentScreenshotPath + '/' + fileName;
  const logFileName = getFilename(
    config._fileNameTemplate,
    '.log.json',
    config._configId,
    scenario.sIndex,
    variantOrScenarioLabelSafe,
    selectorIndex,
    cleanedSelectorName,
    viewport.vIndex,
    viewport.label
  );
  const testLogFilePath = config._experimentScreenshotPath + '/' + logFileName;
  const referenceFilePath = config._controlScreenshotPath + '/' + getFilename(
    config._fileNameTemplate,
    config._outputFileFormatSuffix,
    config._configId,
    scenario.sIndex,
    scenarioLabelSafe,
    selectorIndex,
    cleanedSelectorName,
    viewport.vIndex,
    viewport.label
  );
  const referenceLogFilePath = config._controlScreenshotPath + '/' + getFilename(
    config._fileNameTemplate,
    '.log.json',
    config._configId,
    scenario.sIndex,
    scenarioLabelSafe,
    selectorIndex,
    cleanedSelectorName,
    viewport.vIndex,
    viewport.label
  );

  const testPair: TestPair = {
    reference: referenceFilePath,
    referenceLog: referenceLogFilePath,
    test: testFilePath,
    testLog: testLogFilePath,
    selector,
    fileName,
    label: scenario.label,
    requireSameDimensions: config.requireSameDimensions,
    mismatchThreshold: config.mismatchThreshold,
    url: scenario.url,
    referenceUrl: scenario.referenceUrl,
    expect: getScenarioExpect(scenario),
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
  ensureFileSuffix,
  glueStringsWithSlash,
  genHash,
  makeSafe,
  getFilename,
  getEngineOption,
  getSelectorName,
  getScenarioExpect
};
