import * as os from 'node:os';
import { defineConfig } from 'shaka-perf/compare';
import { DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';

// Single source of truth for the host ports both servers bind to.
// SHAKAPERF_CONTROL_PORT / SHAKAPERF_EXPERIMENT_PORT let CI or
// side-by-side projects pick non-conflicting ports without editing this file.
const DEFAULT_CONTROL_PORT = 3020;
const DEFAULT_EXPERIMENT_PORT = 3030;
const CONTROL_PORT = Number(process.env.SHAKAPERF_CONTROL_PORT ?? DEFAULT_CONTROL_PORT);
const EXPERIMENT_PORT = Number(process.env.SHAKAPERF_EXPERIMENT_PORT ?? DEFAULT_EXPERIMENT_PORT);

const PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

export default defineConfig({
  shared: {
    controlURL: `http://localhost:${CONTROL_PORT}`,
    experimentURL: `http://localhost:${EXPERIMENT_PORT}`,
    resultsFolder: 'compare-results',
    viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
    parallelism: PARALLELISM,
  },

  visreg: {
    viewports: ['desktop', 'tablet', 'phone'],
    defaultMisMatchThreshold: 0.1,
    maxNumDiffPixels: 50,
    comparePixelmatchThreshold: 0.1,
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

  // Uncomment + edit if you use twin-servers (Docker A/B testing infra).
  // `ports` reuses the constants above so the host-port mapping, the URLs
  // visreg/perf hit, and twins-notify-server-started all stay in sync.
  // twinServers: {
  //   projectDir: '.',
  //   controlDir: '../my-app-control',
  //   dockerBuildDir: '..',
  //   dockerfile: 'twin-servers/Dockerfile',
  //   procfile: 'twin-servers/Procfile',
  //   images: {
  //     control: 'my-app:control',
  //     experiment: 'my-app:experiment',
  //   },
  //   volumes: {
  //     control: '~/my_app_control_docker_volume',
  //     experiment: '~/my_app_experiment_docker_volume',
  //   },
  //   ports: {
  //     control: CONTROL_PORT,
  //     experiment: EXPERIMENT_PORT,
  //   },
  // },
});
