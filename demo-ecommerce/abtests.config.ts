import { defineConfig } from 'shaka-perf/compare';

export default defineConfig({
  shared: {
    controlURL: 'http://localhost:3020',
    experimentURL: 'http://localhost:3030',
    resultsFolder: 'compare-results',
  },

  visreg: {
    // viewports default to ['desktop', 'tablet', 'phone'] — full defs live
    // in shared.viewports (also defaulted).
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
    asyncCaptureLimit: 5,
    compareRetries: 2,
    compareRetryDelay: 1000,
    maxNumDiffPixels: 50,
    defaultMisMatchThreshold: 0.1,
  },

  perf: {
    // viewports default to ['desktop', 'phone']. `formFactor` and
    // `screenEmulation` are NOT set here — the viewport referenced from
    // shared.viewports owns them; the runner lowers them via
    // lhConfigForViewport.
    lighthouseConfig: {
      throttling: {
        rttMs: 300,
        throughputKbps: 700,
        requestLatencyMs: 1125,
        downloadThroughputKbps: 700,
        uploadThroughputKbps: 700,
        cpuSlowdownMultiplier: 20,
      },
      throttlingMethod: 'simulate',
      logLevel: 'error',
      output: 'html',
      onlyCategories: ['performance'],
    },
  },

  twinServers: {
    projectDir: '.',
    controlDir: process.env.CONTROL_REPO_DIR || '../../shaka-perf-control/demo-ecommerce',
    dockerBuildDir: '..',
    dockerfile: 'twin-servers/Dockerfile',
    procfile: 'twin-servers/Procfile',
    images: {
      control: 'demo-ecommerce:control',
      experiment: 'demo-ecommerce:experiment',
    },
    volumes: {
      control: '~/demo_ecommerce_control_docker_volume',
      experiment: '~/demo_ecommerce_experiment_docker_volume',
    },
    setupCommands: [
      { command: 'bin/rails db:prepare', description: 'Preparing database' },
      { command: 'bin/rails db:seed', description: 'Seeding database' },
    ],
  },
});
