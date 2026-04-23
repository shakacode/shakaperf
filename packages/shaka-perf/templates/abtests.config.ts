import { defineConfig } from 'shaka-perf/compare';

/**
 * `shaka-perf compare` reads this file. See README + SETUP-twin-servers.md
 * for the full surface; the defaults below are tuned for a local two-server
 * setup where control serves on :3020 and experiment on :3030.
 */
export default defineConfig({
  shared: {
    controlURL: 'http://localhost:3020',
    experimentURL: 'http://localhost:3030',
    resultsFolder: 'compare-results',
  },

  // Visreg's built-in viewports are `[desktop, tablet, phone]`. Override the
  // list here, or per-test via `abTest(name, { options: { visreg: {
  // viewports: [...] } } }, …)`.
  visreg: {},

  // Perf's built-in viewports are `[desktop, phone]`. Each viewport drives a
  // separate Lighthouse pass; form factor + screenEmulation are derived from
  // `width` / `height`. Override per-test via `abTest(name, { options: {
  // perf: { viewports: [...] } } }, …)`.
  perf: {
    numberOfMeasurements: 20,
  },
});
