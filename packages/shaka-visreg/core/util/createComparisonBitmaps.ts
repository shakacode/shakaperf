import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import cloneDeep from 'lodash/cloneDeep.js';
import { writeFile } from 'node:fs/promises';
import _ from 'lodash';
import pMap from 'p-map';
import { clearRegistry, getRegisteredTests } from 'shaka-shared';
import { createPlaywrightBrowser, disposePlaywrightBrowser } from './runPlaywright.js';
import * as runCompareScenario from './runCompareScenario.js';
import ensureDirectoryPath from './ensureDirectoryPath.js';
import { convertAbTestToScenario } from './convertAbTestToScenario.js';
import createLogger from './logger.js';
import type { RuntimeConfig, Scenario, Viewport, Variant, DecoratedCompareConfig, VisregGlobalConfig, TestPair, Browser } from '../types.js';

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

const _require = createRequire(import.meta.url);
const logger = createLogger('liveCompare');

const CONCURRENCY_DEFAULT = 10;

function regexTest (string: string, search: string) {
  const re = new RegExp(search);
  return re.test(string);
}

function ensureViewportLabel (config: { viewports?: Viewport[] }) {
  if (!Array.isArray(config.viewports)) return;
  config.viewports.forEach(function (viewport: Viewport, index: number) {
    if (!viewport.label) {
      viewport.label = viewport.name || ('viewport_' + index);
    }
  });
}

async function loadTestFile (testFilePath: string): Promise<void> {
  const absolutePath = path.resolve(testFilePath);
  const ext = path.extname(absolutePath);

  if (ext === '.ts') {
    const { tsImport } = await import('tsx/esm/api');
    await tsImport(absolutePath, import.meta.url);
  } else {
    await import(pathToFileURL(absolutePath).href);
  }
}

async function loadGlobalVisregConfig (configPath: string): Promise<VisregGlobalConfig> {
  const absolutePath = path.resolve(configPath);
  const ext = path.extname(absolutePath);

  let mod;
  if (ext === '.ts') {
    const { tsImport } = await import('tsx/esm/api');
    const tsModule = await tsImport(absolutePath, import.meta.url);
    mod = tsModule.default?.default ?? tsModule.default ?? tsModule;
  } else {
    const jsModule = await import(pathToFileURL(absolutePath).href);
    mod = jsModule.default ?? jsModule;
  }

  return mod as VisregGlobalConfig;
}

async function decorateConfigForTestFile (config: RuntimeConfig) {
  const testFilePath = config.args.testFile as string;
  const controlURL = (config.args.controlURL as string) || 'http://localhost:3020';
  const experimentURL = (config.args.experimentURL as string) || 'http://localhost:3030';

  clearRegistry();
  await loadTestFile(testFilePath);
  const tests = getRegisteredTests();

  if (tests.length === 0) {
    throw new Error('No tests registered in ' + testFilePath + '. Did you call abTest()?');
  }

  // Load global visreg config if provided
  let globalConfig: Partial<VisregGlobalConfig> = {};
  const configArg = config.args.config as string | undefined;
  if (configArg && configArg !== 'visreg.json') {
    // A custom config was explicitly provided — load it as a global visreg config
    globalConfig = await loadGlobalVisregConfig(configArg);
  }

  // Convert AbTestDefinitions to Scenarios
  const scenarios = tests.map(function (t) {
    return convertAbTestToScenario(t, controlURL, experimentURL);
  });

  // Build the decorated config object with a default viewport if none specified
  const defaultViewports: Viewport[] = [{ label: 'desktop', width: 1280, height: 800 }];
  const configJSON: Record<string, unknown> = {
    ...globalConfig,
    viewports: globalConfig.viewports || defaultViewports,
    engineOptions: globalConfig.engineOptions || { browser: 'chromium' },
    scenarios,
  };
  ensureViewportLabel(configJSON as { viewports?: Viewport[] });

  if ((configJSON as Record<string, unknown>).dynamicTestId) {
    console.log('dynamicTestId \'' + (configJSON as Record<string, unknown>).dynamicTestId + '\' found. shaka-visreg will run in dynamic-test mode.');
  }

  configJSON.env = cloneDeep(config);
  configJSON.isReference = false;
  configJSON.isCompare = true;
  configJSON.paths = (configJSON.paths as Record<string, unknown>) || {};
  (configJSON.paths as Record<string, unknown>).tempCompareConfigFileName = config.tempCompareConfigFileName;
  configJSON.defaultMisMatchThreshold = config.defaultMisMatchThreshold;
  configJSON.configFileName = config.configFileName;
  configJSON.defaultRequireSameDimensions = config.defaultRequireSameDimensions;

  configJSON.compareRetries = config.compareRetries;
  configJSON.compareRetryDelay = config.compareRetryDelay;
  configJSON.maxNumDiffPixels = config.maxNumDiffPixels;

  if (config.args.filter) {
    const filtered: Scenario[] = [];
    (config.args.filter as string).split(',').forEach(function (filteredTest: string) {
      (configJSON.scenarios as Scenario[]).forEach(function (scenario: Scenario) {
        if (regexTest(scenario.label, filteredTest)) {
          filtered.push(scenario);
        }
      });
    });
    configJSON.scenarios = filtered;
  }

  const totalScenarioCount = tests.length;
  logger.log('Selected ' + (configJSON.scenarios as Scenario[]).length + ' of ' + totalScenarioCount + ' scenarios.');
  return configJSON as unknown as DecoratedCompareConfig;
}

function decorateConfigForCompare (config: RuntimeConfig) {
  let configJSON;

  if (typeof config.args.config === 'object') {
    configJSON = cloneDeep(config.args.config);
  } else {
    if (!existsSync(config.configFileName)) {
      throw new Error(
        'Config file not found: ' + config.configFileName + '\n' +
        'Either provide a --config path or use --testFile to load scenarios from abTest() definitions.'
      );
    }
    configJSON = cloneDeep(_require(config.configFileName));
  }
  configJSON.scenarios = configJSON.scenarios || [];
  ensureViewportLabel(configJSON);

  const totalScenarioCount = configJSON.scenarios.length;

  if (configJSON.dynamicTestId) {
    console.log('dynamicTestId \'' + configJSON.dynamicTestId + '\' found. shaka-visreg will run in dynamic-test mode.');
  }

  configJSON.env = cloneDeep(config);
  configJSON.isReference = false;
  configJSON.isCompare = true;
  configJSON.paths = configJSON.paths || {};
  configJSON.paths.tempCompareConfigFileName = config.tempCompareConfigFileName;
  configJSON.defaultMisMatchThreshold = config.defaultMisMatchThreshold;
  configJSON.configFileName = config.configFileName;
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

      pMap(scenarioViews as Required<ScenarioView>[], runCompareScenario.playwright, { concurrency: asyncCaptureLimit }).then(function (out: unknown) {
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
  let decoratedConfig: DecoratedCompareConfig;
  if (config.args.testFile) {
    decoratedConfig = await decorateConfigForTestFile(config);
  } else {
    decoratedConfig = decorateConfigForCompare(config);
  }

  const rawTestPairs = await delegateCompareScenarios(decoratedConfig);
  const result = {
    compareConfig: {
      testPairs: flatMapTestPairs(rawTestPairs as CompareResult[])
    }
  };
  return writeCompareConfigFile(config.tempCompareConfigFileName, result);
}
