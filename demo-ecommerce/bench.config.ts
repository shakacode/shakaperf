import { defineConfig } from "shaka-bench";

export default defineConfig({
  formFactor: "mobile",
  screenEmulation: {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  throttlingMethod: "simulate",
  logLevel: "error",
  output: "html",
  onlyCategories: ["performance"],
});
