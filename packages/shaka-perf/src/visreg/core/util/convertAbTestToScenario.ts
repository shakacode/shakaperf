import type { AbTestDefinition, Viewport as SharedViewport } from 'shaka-shared';
import type { Scenario, Viewport } from '../types';

export function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string,
  categoryViewports: SharedViewport[] = [],
): Scenario {
  const visreg = testDef.options.visreg ?? {};

  // Build scenario with only defined properties to avoid _.has() returning
  // true for undefined values (which causes .map() crashes in preparePage).
  const scenario: Scenario = {
    label: testDef.name,
    url: new URL(testDef.startingPath, experimentURL).href,
    referenceUrl: new URL(testDef.startingPath, controlURL).href,
    selectors: visreg.selectors ?? ['document'],
    _testFn: testDef.testFn,
    _testDef: testDef,
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
  if (visreg.comparePixelmatchThreshold != null) scenario.comparePixelmatchThreshold = visreg.comparePixelmatchThreshold;
  if (visreg.useBoundingBoxViewportForSelectors != null) scenario.useBoundingBoxViewportForSelectors = visreg.useBoundingBoxViewportForSelectors;

  if (visreg.readyEvent) scenario.readyEvent = visreg.readyEvent;
  if (visreg.readySelector) scenario.readySelector = visreg.readySelector;
  if (visreg.readyTimeout != null) scenario.readyTimeout = visreg.readyTimeout;
  if (visreg.delay != null) scenario.delay = visreg.delay;

  if (visreg.cookiePath) scenario.cookiePath = visreg.cookiePath;
  if (visreg.onBefore) scenario.onBefore = visreg.onBefore;

  // Per-test viewport narrowing from top-level `options.viewports`
  // (label-based, shared across categories). When set, we filter the
  // category's resolved viewports to the labeled subset and pass the
  // full Viewport objects down as `scenario.viewports` so the engine
  // only runs the ones this test actually wants — mirroring how perf's
  // `perfBuckets` narrow the bench pass. The compare runner also
  // filters at harvest time as defence-in-depth.
  //
  // Unknown labels are dropped silently (no `shared.viewports` cross-
  // check is possible here — Zod validates config-level labels, but
  // per-test `options.viewports` lives on a plain TS test file).
  const narrow = testDef.options.viewports;
  if (narrow && narrow.length > 0 && categoryViewports.length > 0) {
    const narrowSet = new Set(narrow);
    const filtered = categoryViewports.filter((v) => narrowSet.has(v.label));
    if (filtered.length > 0) {
      scenario.viewports = filtered as Viewport[];
    }
  }

  return scenario;
}
