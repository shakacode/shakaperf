import cloneDeep from 'lodash/cloneDeep.js';
import { writeFile } from 'node:fs/promises';
import _ from 'lodash';
import pMap from 'p-map';
import { loadTests, TestType } from 'shaka-shared';
import { createPlaywrightBrowser, disposePlaywrightBrowser } from './runPlaywright';
import * as runCompareScenario from './runCompareScenario';
import ensureDirectoryPath from './ensureDirectoryPath';
import { convertAbTestToScenario } from './convertAbTestToScenario';
import createLogger from './logger';
import { installTestNamePrefix, runWithTestName, registerTestNames } from './testContext';
import type { RuntimeConfig, Scenario, Viewport, Variant, DecoratedCompareConfig, VisregGlobalConfig, TestPair, Browser } from '../types';

interface ScenarioView {
  scenario: Scenario;
  viewport: Viewport;
  config: DecoratedCompareConfig;
  id: number;
  _playwrightBrowser?: Browser;
}

interface CompareResult {
  testPairs?: TestPair[];
  scenario?: Scenario;
  viewport?: Viewport;
  msg?: string;
  originalError?: Error;
}

const logger = createLogger('compare');

const CONCURRENCY_DEFAULT = 10;

function ensureViewportLabel (config: { viewports?: Viewport[] }) {
  if (!Array.isArray(config.viewports)) return;
  config.viewports.forEach(function (viewport: Viewport, index: number) {
    if (!viewport.label) {
      viewport.label = viewport.name || ('viewport_' + index);
    }
  });
}

async function decorateConfigForTestFile (config: RuntimeConfig) {
  const testPathPattern = config.args.testPathPattern as string | undefined;
  const controlURL = (config.args.controlURL as string) || 'http://localhost:3020';
  const experimentURL = (config.args.experimentURL as string) || 'http://localhost:3030';

  const filter = config.args.filter as string | undefined;
  const tests = await loadTests({
    testPathPattern,
    filter,
    testType: TestType.VisualRegression,
    log: function (msg) { logger.log(msg); },
  });

  // Global config was already loaded in makeConfig and passed through extendConfig.
  // Retrieve it for viewports/engineOptions which aren't on RuntimeConfig.
  const globalConfig = (config.args._loadedVisregConfig as Partial<VisregGlobalConfig>) || {};

  // Convert AbTestDefinitions to Scenarios
  const scenarios = tests.map(function (t) {
    return convertAbTestToScenario(t, controlURL, experimentURL);
  });

  const configJSON: Record<string, unknown> = {
    ...globalConfig,
    viewports: globalConfig.viewports,
    engineOptions: globalConfig.engineOptions || { browser: 'chromium' },
    scenarios,
  };
  ensureViewportLabel(configJSON as { viewports?: Viewport[] });

  if ((configJSON as Record<string, unknown>).dynamicTestId) {
    console.log('dynamicTestId \'' + (configJSON as Record<string, unknown>).dynamicTestId + '\' found. shaka-perf visreg will run in dynamic-test mode.');
  }

  configJSON.env = cloneDeep(config);
  configJSON.isReference = false;
  configJSON.isCompare = true;
  configJSON.paths = (configJSON.paths as Record<string, unknown>) || {};
  configJSON.defaultMisMatchThreshold = config.defaultMisMatchThreshold;
  configJSON.configFileName = config.configFileName;
  configJSON.defaultRequireSameDimensions = config.defaultRequireSameDimensions;

  configJSON.compareRetries = config.compareRetries;
  configJSON.compareRetryDelay = config.compareRetryDelay;
  configJSON.maxNumDiffPixels = config.maxNumDiffPixels;

  return configJSON as unknown as DecoratedCompareConfig;
}

function saveViewportIndexes (viewport: Viewport, index: number) {
  return Object.assign({}, viewport, { vIndex: index });
}

function delegateCompareScenarios (config: DecoratedCompareConfig) {
  const scenarios: Scenario[] = [];
  const scenarioViews: ScenarioView[] = [];

  config.viewports = config.viewports.map(saveViewportIndexes);

  config.scenarios.forEach(function (scenario: Scenario, i: number) {
    scenario.sIndex = i;
    scenario.selectors = scenario.selectors || [];
    if (scenario.viewports) {
      scenario.viewports = scenario.viewports.map(saveViewportIndexes);
    }
    scenarios.push(scenario);

    if (_.has(scenario, 'variants')) {
      scenario.variants!.forEach(function (variant: Variant) {
        variant._parent = scenario;
        scenarios.push(variant as unknown as Scenario);
      });
    }
  });

  let scenarioViewId = 0;
  scenarios.forEach(function (scenario: Scenario) {
    let desiredViewportsForScenario = config.viewports;

    if (scenario.viewports && scenario.viewports.length > 0) {
      desiredViewportsForScenario = scenario.viewports;
    }

    desiredViewportsForScenario.forEach(function (viewport: Viewport) {
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

      registerTestNames(scenarioViews.map(function (v) { return v.scenario.label; }));
      installTestNamePrefix();
      pMap(scenarioViews as Required<ScenarioView>[], function (view: Required<ScenarioView>) {
        return runWithTestName(view.scenario.label, function () { return runCompareScenario.playwright(view); });
      }, { concurrency: asyncCaptureLimit }).then(function (out: unknown) {
        disposePlaywrightBrowser(browser!).then(function () { resolve(out); });
      }, function (e: unknown) {
        disposePlaywrightBrowser(browser!).then(function () { reject(e); });
      });
    }, function (e: unknown) { reject(e); });
  });
}

function writeCompareConfigFile (comparePairsFileName: string, compareConfig: { compareConfig: { testPairs: TestPair[] } }) {
  const compareConfigJSON = JSON.stringify(compareConfig, null, 2);
  ensureDirectoryPath(comparePairsFileName);
  return writeFile(comparePairsFileName, compareConfigJSON);
}

function flatMapTestPairs (rawTestPairs: CompareResult[]) {
  return rawTestPairs.reduce(function (acc: TestPair[], result: CompareResult) {
    let testPairs: TestPair[] | TestPair | undefined = result.testPairs;
    if (!testPairs) {
      // Error fallback — create a stub test pair for reporting
      testPairs = {
        reference: '',
        test: '',
        selector: '',
        fileName: '',
        label: '',
        requireSameDimensions: true,
        misMatchThreshold: 0,
        url: '',
        expect: 0,
        viewportLabel: result.viewport?.label ?? '',
        scenario: result.scenario,
        viewport: result.viewport,
        msg: result.msg,
        error: result.originalError?.name
      } satisfies TestPair;
    }
    return acc.concat(testPairs);
  }, []);
}

export default async function createComparisonBitmaps (config: RuntimeConfig) {
  const decoratedConfig = await decorateConfigForTestFile(config);

  const rawTestPairs = await delegateCompareScenarios(decoratedConfig);
  const result = {
    compareConfig: {
      testPairs: flatMapTestPairs(rawTestPairs as CompareResult[])
    }
  };
  return writeCompareConfigFile(config.tempCompareConfigFileName, result);
}
