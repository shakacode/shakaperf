import { defineVisregConfig } from 'shaka-visreg';

export default defineVisregConfig({
  id: 'demo-ecommerce',
  viewports: [
    { label: 'phone', width: 375, height: 667 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1280, height: 800 },
  ],
  paths: {
    htmlReport: 'visreg_data/html_report',
    ciReport: 'visreg_data/ci_report',
  },
  report: ['browser', 'CI'],
  engineOptions: {
    browser: 'chromium',
    args: ['--no-sandbox'],
  },
  asyncCaptureLimit: 5,
  compareRetries: 2,
  compareRetryDelay: 1000,
  maxNumDiffPixels: 50,
  defaultMisMatchThreshold: 0.1,
});
