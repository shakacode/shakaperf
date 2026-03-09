import runner from '../../core/runner.js';

console.log('Running a multi-step shaka-visreg test. vvv');

// this will run `visreg test` with default config file (./visreg.json in current directory)
runner('test')
  .catch(approveChanges)
  .then(() => {
    // this invocation is equivalent to running `visreg test --config=visreg_features --filter=click`
    return runner('test', {
      filter: 'click',
      config: 'visreg_features'
    });
  })
  .catch(approveChanges)
  .then(() => {
    // this invocation is equivalent to running `visreg test --filter=Delayed` on exampleConfig.
    return runner('test', exampleConfig);
  })
  .catch(approveChanges);

/**
 * run this to approve changes from the previous run.
 */
function approveChanges () {
  console.log('Looks like there were some changes detected since last run.');
  runner('approve', {
    config: {
      id: 'explicity_defined',
      paths: {
        bitmaps_reference: 'visreg_data/bitmaps_reference',
        bitmaps_test: 'visreg_data/bitmaps_test'
      }
    }
  });
}

/**
 * A config used to test explicity setting a config.
 * @type {Object}
 */
const exampleConfig = {
  filter: 'Delayed',
  config: {
    id: 'explicity_defined',
    viewports: [
      {
        label: 'phone',
        width: 320,
        height: 480
      },
      {
        label: 'tablet',
        width: 1024,
        height: 768
      }
    ],
    onBeforeScript: 'playwright/onBefore.js',
    onReadyScript: 'playwright/onReady.js',
    scenarios: [
      {
        label: 'Homepage',
        cookiePath: 'visreg_data/engine_scripts/cookies.json',
        url: 'https://garris.github.io/BackstopJS/?delay'
      },
      {
        label: 'Homepage Delayed',
        cookiePath: 'visreg_data/engine_scripts/cookies.json',
        url: 'https://garris.github.io/BackstopJS/?delay'
      }
    ],
    paths: {
      bitmaps_reference: 'visreg_data/bitmaps_reference',
      bitmaps_test: 'visreg_data/bitmaps_test',
      engine_scripts: 'visreg_data/engine_scripts',
      html_report: 'visreg_data/html_report',
      ci_report: 'visreg_data/ci_report'
    },
    report: ['browser'],
    engine: 'playwright',
    asyncCaptureLimit: 5,
    asyncCompareLimit: 50,
    debug: false,
    debugWindow: false
  }
};
