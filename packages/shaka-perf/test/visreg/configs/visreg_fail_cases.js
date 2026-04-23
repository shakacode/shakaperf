/**
 * PUT ALL 'FAILING' TESTS IN HERE
 */

const ENGINE = 'playwright';
const SCRIPT_PATH = 'playwright';

module.exports = {
  id: `${ENGINE}_visreg_features`,
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
      url: '../../index.html',
      selectors: ['.doesNotExist']
    },
    {
      label: 'click',
      url: '../../index.html?click',
      clickSelector: '#alsoDoesNotExist',
      selectors: ['.moneyshot']
    },
    {
      label: 'expect',
      url: '../../index.html',
      selectors: ['p'],
      selectorExpansion: true,
      expect: 8
    }
  ],
  paths: {
    htmlReport: 'visreg_data/html_report',
    ciReport: 'visreg_data/ci_report'
  },
  report: ['browser'],
  engine: ENGINE,
  engineOptions: {},
  asyncCaptureLimit: 10,
  asyncCompareLimit: 50,
  debug: false,
  debugWindow: false
};
