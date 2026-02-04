/**
 * Admin app bundle size configuration
 */

import { defineConfig, RegressionType, type Regression } from 'shaka-bundle-size';

export default defineConfig({
  // Path to webpack loadable stats
  statsFile: 'public/packs/admin-loadable-stats.json',

  // Baseline configuration
  baselineDir: 'tmp/bundle_size',
  bundleNamePrefix: 'admin',
  // baselineFile: 'admin-config.json', // default value. dervied from bundleNamePrefix

  // Thresholds (admin is more lenient than consumer)
  thresholds: {
    default: 50, // 50 KB for normal components
    keyComponents: ['admin'],
    keyComponentThreshold: 5, // 5 KB for key components
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

  // Path to file to acknowledge bundle-size regressions
  acknowledgedBranchesFilePath: 'test/acknowledge-bundle-size.txt',

  // Custom regression policy for admin app
  regressionPolicy: (regression: Regression) => {
    const { componentName, type, sizeDiffKb } = regression;
    const isKeyComponent = ['admin'].includes(componentName);
    const threshold = isKeyComponent ? 5 : 50;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        // Admin app is more lenient about new components
        console.log(`\x1b[34mNew component ${componentName} introduced.\x1b[0m`);
        return { shouldFail: false };

      case RegressionType.REMOVED_COMPONENT:
        if (isKeyComponent) {
          console.log('\x1b[31mDo not remove or update a key component without updating the bundle size configuration.\x1b[0m');
          return { shouldFail: true, message: 'Key component removed' };
        }
        break;

      case RegressionType.INCREASED_SIZE:
        if (sizeDiffKb !== undefined && sizeDiffKb > threshold) {
          console.log(`\x1b[31mThe difference is larger than threshold ${threshold} KB. Consider introducing a new Loadable Component.\x1b[0m`);
          if (isKeyComponent) {
            console.log(`\x1b[31mCareful! "${componentName}" is a key component.\x1b[0m`);
          }
          return { shouldFail: true, message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB` };
        }
        break;

      case RegressionType.INCREASED_CHUNKS_COUNT:
        // Admin app is more lenient about chunks
        console.log(`\x1b[33mChunks count increased for ${componentName}.\x1b[0m`);
        return { shouldFail: false };
    }

    // Not a failure
    console.log(`\x1b[34mIgnored minor change in ${componentName}.\x1b[0m`);
    return { shouldFail: false };
  },
});
