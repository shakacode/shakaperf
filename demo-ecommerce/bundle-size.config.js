/**
 * Consumer app bundle size configuration
 */

const { defineConfig, RegressionType, createDefaultPolicy } = require('shaka-bundle-size');

const thresholds = {
  default: 10, // 10 KB for normal components
  keyComponents: ['pages-HomePage'],
  keyComponentThreshold: 1, // 1 KB for key components
};

module.exports = defineConfig({
  acknowledgedBranchesFilePath: 'test/acknowledge-bundle-size.txt',

  // Path to webpack loadable stats
  statsFile: 'public/packs/consumer-loadable-stats.json',
  baselineDir: 'tmp/bundle_size',
  bundleNamePrefix: 'consumer',
  // baselineFile: 'consumer-config.json', // default value. dervied from bundleNamePrefix

  thresholds,
  currentStatsDir: 'tmp/bundle_size_current',
  htmlDiffs: {
    enabled: true,
    outputDir: 'bundle-size-diffs',
  },

  storage: {
    s3Bucket: 'shaka-perf-demo-storage',
    s3Prefix: 'bundle-size/',
    // endpoint and credentials come from env vars: S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    mainCommitsToCheck: 10,
  },

  // Custom regression policy for consumer app
  regressionPolicy: (regression) => {
    const defaultPolicy = createDefaultPolicy(thresholds);

    const { type } = regression;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        // Consumer app requires review for new components
        return { shouldFail: true, message: 'Performance review required for new consumer component' };

      default:
        // Use default policy for other regression types and override new component policy
        return defaultPolicy(regression);
    }
  },
});
