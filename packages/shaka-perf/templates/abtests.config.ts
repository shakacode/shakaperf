import { defineConfig } from 'shaka-perf/compare';
import { DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';

export default defineConfig({
  shared: {
    controlURL: 'http://localhost:3020',
    experimentURL: 'http://localhost:3030',
    resultsFolder: 'compare-results',
    viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
  },

  visreg: {
    viewports: ['desktop', 'tablet', 'phone'],
    defaultMisMatchThreshold: 0.1,
    compareRetries: 2,
    compareRetryDelay: 500,
    maxNumDiffPixels: 50,
    comparePixelmatchThreshold: 0.1,
    asyncCaptureLimit: 2,
    asyncCompareLimit: 4,
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
  },

  perf: {
    numberOfMeasurements: 20,
    regressionThreshold: 0.1,
    pValueThreshold: 0.05,
    regressionThresholdStat: 'estimator',
    samplingMode: 'simultaneous',
    sampleTimeoutMs: 120_000,
    viewports: ['desktop', 'phone'],
  },
});
