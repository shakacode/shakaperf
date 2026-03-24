/* eslint-env browser, node */

module.exports = {
  id: 'visreg-remote',
  viewports: [
    {
      label: 'webview',
      width: 1440,
      height: 900
    }
  ],
  scenarios: [
    {
      label: '{testName}',
      url: '{origin}/backstop/dview/{testId}/{scenarioId}',
      delay: 500
    }
  ],
  paths: {
    bitmaps_reference: 'visreg_data/bitmaps_reference',
    bitmaps_test: 'visreg_data/bitmaps_test',
    html_report: 'visreg_data/html_report',
    ci_report: 'visreg_data/ci_report'
  },
  report: [],
  engine: 'playwright',
  engineOptions: {
    args: ['--no-sandbox']
  },
  asyncCaptureLimit: 10,
  asyncCompareLimit: 50,
  debug: false,
  debugWindow: false
};
