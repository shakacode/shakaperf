import { createRequire } from 'node:module';
import cloneDeep from 'lodash/cloneDeep.js';
import { writeFile } from 'node:fs/promises';
import _ from 'lodash';
import pMap from 'p-map';
import { createPlaywrightBrowser, runPlaywright, disposePlaywrightBrowser } from './runPlaywright.js';
import ensureDirectoryPath from './ensureDirectoryPath.js';
import createLogger from './logger.js';
import type { RuntimeConfig, Scenario, Viewport, Variant } from '../types.js';

const _require = createRequire(import.meta.url);
const logger = createLogger('createBitmaps');

const CONCURRENCY_DEFAULT = 10;

function regexTest (string: string, search: string) {
  const re = new RegExp(search);
  return re.test(string);
}

function ensureViewportLabel (config: any) {
  if (typeof config.viewports === 'object') {
    config.viewports.forEach(function (viewport: Viewport) {
      if (!viewport.label) {
        viewport.label = viewport.name || '';
      }
    });
  }
}

function decorateConfigForCapture (config: RuntimeConfig, isReference: boolean) {
  let configJSON;

  if (typeof config.args.config === 'object') {
    configJSON = config.args.config;
  } else {
    configJSON = Object.assign({}, _require(config.backstopConfigFileName));
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
    console.log(`dynamicTestId '${configJSON.dynamicTestId}' found. BackstopJS will run in dynamic-test mode.`);
  }

  configJSON.env = cloneDeep(config);
  configJSON.isReference = isReference;
  configJSON.paths.tempCompareConfigFileName = config.tempCompareConfigFileName;
  configJSON.defaultMisMatchThreshold = config.defaultMisMatchThreshold;
  configJSON.backstopConfigFileName = config.backstopConfigFileName;
  configJSON.defaultRequireSameDimensions = config.defaultRequireSameDimensions;

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

  logger.log('Selected ' + configJSON.scenarios.length + ' of ' + totalScenarioCount + ' scenarios.');
  return configJSON;
}

function saveViewportIndexes (viewport: Viewport, index: number) {
  return Object.assign({}, viewport, { vIndex: index });
}

function delegateScenarios (config: any) {
  const scenarios: Scenario[] = [];
  const scenarioViews: any[] = [];

  config.viewports = config.viewports.map(saveViewportIndexes);

  // casper.each(scenarios, function (casper, scenario, i) {
  config.scenarios.forEach(function (scenario: Scenario, i: number) {
    // var scenarioLabelSafe = makeSafe(scenario.label);
    scenario.sIndex = i;
    scenario.selectors = scenario.selectors || [];
    if (scenario.viewports) {
      scenario.viewports = scenario.viewports.map(saveViewportIndexes);
    }
    scenarios.push(scenario);

    if (!config.isReference && _.has(scenario, 'variants')) {
      scenario.variants!.forEach(function (variant: Variant) {
        // var variantLabelSafe = makeSafe(variant.label);
        variant._parent = scenario;
        scenarios.push(scenario);
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

  return new Promise((resolve, reject) => {
    createPlaywrightBrowser(config).then(browser => {
      console.log('Browser created');

      for (const view of scenarioViews) {
        view._playwrightBrowser = browser;
      }

      pMap(scenarioViews, runPlaywright, { concurrency: asyncCaptureLimit }).then((out: any) => {
        disposePlaywrightBrowser(browser).then(() => resolve(out));
      }, (e: any) => {
        disposePlaywrightBrowser(browser).then(() => reject(e));
      });
    }, (e: any) => reject(e));
  });
}

function writeCompareConfigFile (comparePairsFileName: string, compareConfig: any) {
  const compareConfigJSON = JSON.stringify(compareConfig, null, 2);
  ensureDirectoryPath(comparePairsFileName);
  return writeFile(comparePairsFileName, compareConfigJSON);
}

function flatMapTestPairs (rawTestPairs: any[]) {
  return rawTestPairs.reduce((acc: any[], result: any) => {
    let testPairs = result.testPairs;
    if (!testPairs) {
      testPairs = {
        diff: {
          isSameDimensions: '',
          dimensionDifference: {
            width: '',
            height: ''
          },
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

export default function createBitmaps (config: RuntimeConfig, isReference: boolean) {
  const promise = delegateScenarios(decorateConfigForCapture(config, isReference))
    .then(rawTestPairs => {
      const result = {
        compareConfig: {
          testPairs: flatMapTestPairs(rawTestPairs as any[])
        }
      };
      return writeCompareConfigFile(config.tempCompareConfigFileName, result);
    });

  return promise;
};
