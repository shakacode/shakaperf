module.exports = {
  id: 'playwright_visreg_features',
  viewports: [
    {
      label: 'mobile',
      width: 320,
      height: 480
    },
    {
      label: 'tablet',
      width: 1024,
      height: 768
    }
  ],
  scenarios: [
    {
      label: 'Simple',
      url: 'https://garris.github.io/BackstopJS/'
    }
  ],
  paths: {
    htmlReport: 'visreg_data/html_report',
    ciReport: 'visreg_data/ci_report'
  },
  report: ['browser'],
  engine: 'playwright',
  engineOptions: {
    args: ['--no-sandbox']
  },
  asyncCaptureLimit: 10,
  asyncCompareLimit: 50,
  debug: false,
  debugWindow: false
};
