import type { AbTestDefinition } from 'shaka-shared';
import type { Scenario } from '../types.js';

export function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string
): Scenario {
  const visreg = testDef.options.visreg ?? {};
  return {
    label: testDef.name,
    url: experimentURL + testDef.startingPath,
    referenceUrl: controlURL + testDef.startingPath,

    // Selectors
    selectors: visreg.selectors ?? ['document'],
    selectorExpansion: visreg.selectorExpansion,
    hideSelectors: visreg.hideSelectors,
    removeSelectors: visreg.removeSelectors,

    // Interactions
    hoverSelector: visreg.hoverSelector,
    hoverSelectors: visreg.hoverSelectors,
    clickSelector: visreg.clickSelector,
    clickSelectors: visreg.clickSelectors,
    scrollToSelector: visreg.scrollToSelector,
    postInteractionWait: visreg.postInteractionWait,

    // Comparison thresholds
    misMatchThreshold: visreg.misMatchThreshold,
    requireSameDimensions: visreg.requireSameDimensions,
    maxNumDiffPixels: visreg.maxNumDiffPixels,
    compareRetries: visreg.compareRetries,
    compareRetryDelay: visreg.compareRetryDelay,
    liveComparePixelmatchThreshold: visreg.liveComparePixelmatchThreshold,

    // Ready state
    readyEvent: visreg.readyEvent,
    readySelector: visreg.readySelector,
    readyTimeout: visreg.readyTimeout,
    delay: visreg.delay,

    // Cookies
    cookiePath: visreg.cookiePath,

    // Scripts (onReadyScript is NOT set — testFn replaces it)
    onBeforeScript: visreg.onBeforeScript,

    // Viewport override
    viewports: visreg.viewports,

    // testFn attached for use in preparePage
    _testFn: testDef.testFn,
  };
}
