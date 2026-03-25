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
    scenarios: [
      {
        label: 'Homepage',
        cookiePath: 'visreg_data/cookies/cookies.json',
        url: 'https://garris.github.io/BackstopJS/?delay'
      },
      {
        label: 'Homepage Delayed',
        cookiePath: 'visreg_data/cookies/cookies.json',
        url: 'https://garris.github.io/BackstopJS/?delay'
      }
    ],
    paths: {
      htmlReport: 'visreg_data/html_report',
      ciReport: 'visreg_data/ci_report'
    },
    report: ['browser'],
    engine: 'playwright',
    asyncCaptureLimit: 5,
    asyncCompareLimit: 50,
    debug: false,
    debugWindow: false
  }
};
