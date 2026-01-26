/**
 * Consumer app bundle size configuration
 */

const { defineConfig, RegressionType } = require('shaka-bundle-size');

module.exports = defineConfig({
  // Path to webpack loadable stats
  statsFile: 'public/packs/consumer-loadable-stats.json',

  // Baseline configuration
  baselineDir: 'tmp/bundle_size',
  bundleNamePrefix: 'consumer',
  // baselineFile: 'consumer-config.json', // default value. dervied from bundleNamePrefix

  // Thresholds
  thresholds: {
    default: 10, // 10 KB for normal components
    keyComponents: ['HomePage'],
    keyComponentThreshold: 1, // 1 KB for key components
  },

  // HTML diff configuration
  htmlDiffs: {
    enabled: true,
    outputDir: 'bundle-size-diffs',
    currentDir: 'tmp/bundle_size_current',
  },

  // Baseline storage for --download/--upload (S3/R2)
  storage: {
    s3Bucket: 'shaka-perf-demo-storage',
    s3Prefix: 'bundle-size/',
    // endpoint and credentials come from env vars: S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    mainCommitsToCheck: 10,
  },

  // Custom regression policy for consumer app
  regressionPolicy: (regression) => {
    const { componentName, type, sizeDiffKb } = regression;
    const isKeyComponent = ['HomePage'].includes(componentName);
    const threshold = isKeyComponent ? 1 : 10;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        // Consumer app requires review for new components
        console.log('\x1b[31mNew components on consumer require review for performance impact.\x1b[0m');
        return { shouldFail: true, message: 'Performance review required for new consumer component' };

      case RegressionType.REMOVED_COMPONENT:
        if (isKeyComponent) {
          console.log('\x1b[31mDo not remove or update a key component without updating the bundle size configuration.\x1b[0m');
          return { shouldFail: true, message: 'Key component removed' };
        }
        break;

      case RegressionType.INCREASED_SIZE:
        if (sizeDiffKb > threshold) {
          console.log(`\x1b[31mThe difference is larger than threshold ${threshold} KB. Consider introducing a new Loadable Component.\x1b[0m`);
          if (isKeyComponent) {
            console.log(`\x1b[31mCareful! "${componentName}" is a key component.\x1b[0m`);
          }
          return { shouldFail: true, message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB` };
        }
        break;

      case RegressionType.INCREASED_CHUNKS_COUNT:
        console.log('\x1b[31mIncreasing chunks number means increased webpack and HTTP overhead. This may be bad for performance.\x1b[0m');
        return { shouldFail: true, message: 'Chunks count increased on consumer app' };
    }

    // Not a failure
    console.log(`\x1b[34mIgnored minor change in ${componentName}.\x1b[0m`);
    return { shouldFail: false };
  },
});
