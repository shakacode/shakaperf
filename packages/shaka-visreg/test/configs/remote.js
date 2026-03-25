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
    htmlReport: 'visreg_data/html_report',
    ciReport: 'visreg_data/ci_report'
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
