import type { AbTestDefinition } from 'shaka-shared';
import type { Scenario } from '../types.js';

export function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string
): Scenario {
  const visreg = testDef.options.visreg ?? {};

  // Build scenario with only defined properties to avoid _.has() returning
  // true for undefined values (which causes .map() crashes in preparePage).
  const scenario: Scenario = {
    label: testDef.name,
    url: experimentURL + testDef.startingPath,
    referenceUrl: controlURL + testDef.startingPath,
    selectors: visreg.selectors ?? ['document'],
    _testFn: testDef.testFn,
  };

  // Only set optional properties when they have a value
  if (visreg.selectorExpansion != null) scenario.selectorExpansion = visreg.selectorExpansion;
  if (visreg.hideSelectors) scenario.hideSelectors = visreg.hideSelectors;
  if (visreg.removeSelectors) scenario.removeSelectors = visreg.removeSelectors;

  if (visreg.hoverSelector) scenario.hoverSelector = visreg.hoverSelector;
  if (visreg.hoverSelectors) scenario.hoverSelectors = visreg.hoverSelectors;
  if (visreg.clickSelector) scenario.clickSelector = visreg.clickSelector;
  if (visreg.clickSelectors) scenario.clickSelectors = visreg.clickSelectors;
  if (visreg.scrollToSelector) scenario.scrollToSelector = visreg.scrollToSelector;
  if (visreg.postInteractionWait != null) scenario.postInteractionWait = visreg.postInteractionWait;

  if (visreg.misMatchThreshold != null) scenario.misMatchThreshold = visreg.misMatchThreshold;
  if (visreg.requireSameDimensions != null) scenario.requireSameDimensions = visreg.requireSameDimensions;
  if (visreg.maxNumDiffPixels != null) scenario.maxNumDiffPixels = visreg.maxNumDiffPixels;
  if (visreg.compareRetries != null) scenario.compareRetries = visreg.compareRetries;
  if (visreg.compareRetryDelay != null) scenario.compareRetryDelay = visreg.compareRetryDelay;
  if (visreg.liveComparePixelmatchThreshold != null) scenario.liveComparePixelmatchThreshold = visreg.liveComparePixelmatchThreshold;

  if (visreg.readyEvent) scenario.readyEvent = visreg.readyEvent;
  if (visreg.readySelector) scenario.readySelector = visreg.readySelector;
  if (visreg.readyTimeout != null) scenario.readyTimeout = visreg.readyTimeout;
  if (visreg.delay != null) scenario.delay = visreg.delay;

  if (visreg.cookiePath) scenario.cookiePath = visreg.cookiePath;
  if (visreg.onBeforeScript) scenario.onBeforeScript = visreg.onBeforeScript;
  if (visreg.viewports) scenario.viewports = visreg.viewports;

  return scenario;
}
