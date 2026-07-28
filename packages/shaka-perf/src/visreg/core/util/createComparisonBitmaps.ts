/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import cloneDeep from 'lodash/cloneDeep.js';
import { writeFile } from 'node:fs/promises';
import pMap from 'p-map';
import { loadTests } from '../../../config-loader';
import { createPlaywrightBrowser, disposePlaywrightBrowser } from './runPlaywright';
import * as runCompareScenario from './runCompareScenario';
import ensureDirectoryPath from './ensureDirectoryPath';
import { convertAbTestToScenario, type ScenarioUrls } from './convertAbTestToScenario';
import createLogger from './logger';
import type { RuntimeConfig, Scenario, Viewport, DecoratedCompareConfig, VisregEngineInputConfig, CompareConfig, Browser, VisregRunRuntime } from '../types';

interface ScenarioView {
  scenario: Scenario;
  viewport: Viewport;
  config: DecoratedCompareConfig;
  id: number;
  _playwrightBrowser?: Browser;
}

/** One scenario invocation's output — the same shape `CompareConfig` persists. */
type CompareResult = CompareConfig;

const logger = createLogger('compare');

const CONCURRENCY_DEFAULT = 10;

async function decorateConfigForTestFile (config: RuntimeConfig) {
  const testPathPattern = config.args.testPathPattern as string | undefined;
  const controlURL = config.args.controlURL as string;
  const experimentURL = config.args.experimentURL as string;
  if (!controlURL || !experimentURL) {
    throw new Error(
      'visreg engine: controlURL and experimentURL must be provided via args ' +
      '(the compare bridge sets these — direct callers must too).',
    );
  }

  const filter = config.args.filter as string | undefined;
  const tests = await loadTests({
    testPathPattern,
    filter,
    testType: 'visreg',
    log: function (msg) { logger.log(msg); },
  });

  // Engine-input config was loaded in makeConfig and stashed on
  // `config.args._loadedVisregConfig`. Retrieve it for viewports /
  // playwrightOptions / etc. which aren't part of RuntimeConfig.
  const globalConfig = (config.args._loadedVisregConfig as Partial<VisregEngineInputConfig>) || {};

  // Convert AbTestDefinitions to Scenarios. Per-test viewport narrowing is
  // applied upstream by the runner (it only expands work units for a test's
  // effective viewports), so the engine runs whatever single viewport this
  // unit was handed — no narrowing needed here.
  const stageUnitUrls = tests.length === 1
    ? config.args.stageUnitUrls as ScenarioUrls | undefined
    : undefined;
  const scenarios = tests
    .map(function (test) {
      return convertAbTestToScenario(test, controlURL, experimentURL, stageUnitUrls);
    });

  const configJSON: Record<string, unknown> = {
    ...globalConfig,
    viewports: globalConfig.viewports,
    // No default here: the compare bridge always writes the resolved options;
    // a standalone config without them hits createPlaywrightBrowser's visible
    // assume-chromium warning rather than a silent default.
    playwrightOptions: globalConfig.playwrightOptions || {},
    scenarios,
  };

  configJSON.env = cloneDeep(config);
  configJSON.mismatchThreshold = config.mismatchThreshold;
  configJSON.configFileName = config.configFileName;

  configJSON.compareRetries = config.compareRetries;
  configJSON.compareRetryDelay = config.compareRetryDelay;
  configJSON.maxNumDiffPixels = config.maxNumDiffPixels;

  return configJSON as unknown as DecoratedCompareConfig;
}

function saveViewportIndexes (viewport: Viewport, index: number) {
  return Object.assign({}, viewport, { vIndex: index });
}

function delegateCompareScenarios (
  config: DecoratedCompareConfig,
  runtime: VisregRunRuntime,
) {
  const scenarioViews: ScenarioView[] = [];

  config.viewports = config.viewports.map(saveViewportIndexes);

  let scenarioViewId = 0;
  config.scenarios.forEach(function (scenario: Scenario, i: number) {
    scenario.sIndex = i;
    config.viewports.forEach(function (viewport: Viewport) {
      scenarioViews.push({
        scenario,
        viewport,
        config,
        id: scenarioViewId++
      });
    });
  });

  const asyncCaptureLimit = config.asyncCaptureLimit === 0 ? 1 : config.asyncCaptureLimit || CONCURRENCY_DEFAULT;

  return new Promise(function (resolve, reject) {
    createPlaywrightBrowser(config).then(function (browser) {
      logger.log('Browser created');

      for (let i = 0; i < scenarioViews.length; i++) {
        scenarioViews[i]._playwrightBrowser = browser;
      }

      pMap(scenarioViews as Required<ScenarioView>[], function (view: Required<ScenarioView>) {
        return runCompareScenario.playwright(view, runtime);
      }, { concurrency: asyncCaptureLimit }).then(function (out: unknown) {
        disposePlaywrightBrowser(browser).then(function () { resolve(out); });
      }, function (e: unknown) {
        disposePlaywrightBrowser(browser).then(function () { reject(e); });
      });
    }, function (e: unknown) { reject(e); });
  });
}

function writeCompareConfigFile (comparePairsFileName: string, compareConfig: { compareConfig: CompareConfig }) {
  const compareConfigJSON = JSON.stringify(compareConfig, null, 2);
  ensureDirectoryPath(comparePairsFileName);
  return writeFile(comparePairsFileName, compareConfigJSON);
}

// A scenario that throws rejects the whole pMap (the framework's unit-level
// retry/error reporting owns that path), so every result here has testPairs.
function flatMapTestPairs (rawTestPairs: CompareResult[]) {
  return rawTestPairs.flatMap(function (result: CompareResult) {
    return result.testPairs;
  });
}

export default async function createComparisonBitmaps (
  config: RuntimeConfig,
  runtime: VisregRunRuntime,
) {
  const decoratedConfig = await decorateConfigForTestFile(config);

  const rawTestPairs = await delegateCompareScenarios(decoratedConfig, runtime);
  const result = {
    compareConfig: {
      testPairs: flatMapTestPairs(rawTestPairs as CompareResult[])
    }
  };
  return writeCompareConfigFile(config.tempCompareConfigFileName, result);
}
