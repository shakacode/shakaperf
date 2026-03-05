import { createRequire } from 'node:module';
import cloneDeep from 'lodash/cloneDeep.js';
import { writeFile } from 'node:fs/promises';
import _ from 'lodash';
import pMap from 'p-map';
import { createPlaywrightBrowser, disposePlaywrightBrowser } from './runPlaywright.js';
import * as runCompareScenario from './runCompareScenario.js';
import ensureDirectoryPath from './ensureDirectoryPath.js';
import createLogger from './logger.js';
import type { RuntimeConfig, Scenario, Viewport, Variant } from '../types.js';

const _require = createRequire(import.meta.url);
const logger = createLogger('liveCompare');

const CONCURRENCY_DEFAULT = 10;

function regexTest (string: string, search: string) {
  const re = new RegExp(search);
  return re.test(string);
}

function ensureViewportLabel (config: any) {
  if (!Array.isArray(config.viewports)) return;
  config.viewports.forEach(function (viewport: Viewport, index: number) {
    if (!viewport.label) {
      viewport.label = viewport.name || ('viewport_' + index);
    }
  });
}

function decorateConfigForCompare (config: RuntimeConfig) {
  let configJSON;

  if (typeof config.args.config === 'object') {
    configJSON = cloneDeep(config.args.config);
  } else {
    configJSON = cloneDeep(_require(config.backstopConfigFileName));
  }
  configJSON.scenarios = configJSON.scenarios || [];
  ensureViewportLabel(configJSON);

  const totalScenarioCount = configJSON.scenarios.length;

  function pad (number: number) {
    let r = String(number);
    if (r.length === 1) {
      r = '0' + r;
    }
    return r;
  }

  const screenshotNow = new Date();
  let screenshotDateTime = screenshotNow.getFullYear() + pad(screenshotNow.getMonth() + 1) + pad(screenshotNow.getDate()) + '-' + pad(screenshotNow.getHours()) + pad(screenshotNow.getMinutes()) + pad(screenshotNow.getSeconds());
  screenshotDateTime = configJSON.dynamicTestId ? configJSON.dynamicTestId : screenshotDateTime;
  configJSON.screenshotDateTime = screenshotDateTime;
  config.screenshotDateTime = screenshotDateTime;

  if (configJSON.dynamicTestId) {
    console.log('dynamicTestId \'' + configJSON.dynamicTestId + '\' found. BackstopJS will run in dynamic-test mode.');
  }

  configJSON.env = cloneDeep(config);
  configJSON.isReference = false;
  configJSON.isCompare = true;
  configJSON.paths = configJSON.paths || {};
  configJSON.paths.tempCompareConfigFileName = config.tempCompareConfigFileName;
  configJSON.defaultMisMatchThreshold = config.defaultMisMatchThreshold;
  configJSON.backstopConfigFileName = config.backstopConfigFileName;
  configJSON.defaultRequireSameDimensions = config.defaultRequireSameDimensions;

  // Pass through compare-specific config
  configJSON.compareRetries = config.compareRetries;
  configJSON.compareRetryDelay = config.compareRetryDelay;
  configJSON.maxNumDiffPixels = config.maxNumDiffPixels;

  if (config.args.filter) {
    const scenarios: Scenario[] = [];
    (config.args.filter as string).split(',').forEach(function (filteredTest: string) {
      configJSON.scenarios.forEach(function (scenario: Scenario) {
        if (regexTest(scenario.label, filteredTest)) {
          scenarios.push(scenario);
        }
      });
    });
    configJSON.scenarios = scenarios;
  }

  // Validate that all scenarios have referenceUrl
  const missingReferenceUrl = configJSON.scenarios.filter(function (s: Scenario) { return !s.referenceUrl; });
  if (missingReferenceUrl.length > 0) {
    const labels = missingReferenceUrl.map(function (s: Scenario) { return '"' + s.label + '"'; }).join(', ');
    throw new Error('liveCompare requires referenceUrl for all scenarios. Missing on: ' + labels);
  }

  logger.log('Selected ' + configJSON.scenarios.length + ' of ' + totalScenarioCount + ' scenarios.');
  return configJSON;
}

function saveViewportIndexes (viewport: Viewport, index: number) {
  return Object.assign({}, viewport, { vIndex: index });
}

function delegateCompareScenarios (config: any) {
  const scenarios: Scenario[] = [];
  const scenarioViews: any[] = [];

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

      pMap(scenarioViews, runCompareScenario.playwright, { concurrency: asyncCaptureLimit }).then(function (out: any) {
        disposePlaywrightBrowser(browser).then(function () { resolve(out); });
      }, function (e: any) {
        disposePlaywrightBrowser(browser).then(function () { reject(e); });
      });
    }, function (e: any) { reject(e); });
  });
}

function writeCompareConfigFile (comparePairsFileName: string, compareConfig: any) {
  const compareConfigJSON = JSON.stringify(compareConfig, null, 2);
  ensureDirectoryPath(comparePairsFileName);
  return writeFile(comparePairsFileName, compareConfigJSON);
}

function flatMapTestPairs (rawTestPairs: any[]) {
  return rawTestPairs.reduce(function (acc: any[], result: any) {
    let testPairs = result.testPairs;
    if (!testPairs) {
      testPairs = {
        diff: {
          isSameDimensions: '',
          dimensionDifference: { width: '', height: '' },
          misMatchPercentage: ''
        },
        reference: '',
        test: '',
        selector: '',
        fileName: '',
        label: '',
        scenario: result.scenario,
        viewport: result.viewport,
        msg: result.msg,
        error: result.originalError && result.originalError.name
      };
    }
    return acc.concat(testPairs);
  }, []);
}

export default function createComparisonBitmaps (config: RuntimeConfig) {
  const promise = delegateCompareScenarios(decorateConfigForCompare(config))
    .then(function (rawTestPairs) {
      const result = {
        compareConfig: {
          testPairs: flatMapTestPairs(rawTestPairs as any[])
        }
      };
      return writeCompareConfigFile(config.tempCompareConfigFileName, result);
    });

  return promise;
};
