import {
  DESKTOP_VIEWPORT,
  PHONE_VIEWPORT,
  defineConfig,
  installRequestBlocking,
} from 'shaka-shared';

const LIGHTHOUSE_CONFIG = {
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  throttlingMethod: 'simulate' as const,
  logLevel: 'error' as const,
  output: 'html' as const,
  onlyCategories: ['performance'],
};

export default defineConfig({
  shared: {
    controlURL: process.env.HICHEE_VISREG_CONTROL_URL || 'http://localhost:3013',
    experimentURL: process.env.HICHEE_VISREG_EXPERIMENT_URL || 'http://localhost:3012',
    viewports: [DESKTOP_VIEWPORT, PHONE_VIEWPORT],
    parallelism: 1,
    retries: 0,
    timeoutMs: 180_000,
    testPathPattern: 'hichee-pages\\.abtest\\.ts$',
    beforeNavigate: async ({ context }) => {
      await context.addInitScript(() => {
        window.localStorage.setItem('cookieConsentPerformed', 'true');
      });

      await installRequestBlocking(context, [
        '/recaptcha/',
        'adservice.google.com',
        'doubleclick.net',
        'google-analytics.com',
        'googleadservices.com',
        'googletagmanager.com',
        'googlesyndication.com',
        'intercom.io',
        'intercomcdn.com',
        'sentry.io',
      ]);
    },
  },

  visreg: {
    viewports: ['desktop', 'phone'],
    defaultMisMatchThreshold: 0.01,
    maxNumDiffPixels: 50,
    comparePixelmatchThreshold: 0.1,
    compareRetries: 2,
    compareRetryDelay: 1_000,
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
  },

  perf: {
    viewports: ['desktop', 'phone'],
    lighthouseConfig: LIGHTHOUSE_CONFIG,
    numberOfMeasurements: 10,
  },
});
