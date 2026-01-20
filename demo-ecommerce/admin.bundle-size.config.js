/**
 * Admin app bundle size configuration
 */

const { defineConfig, RegressionType } = require('shaka-bundle-size');

module.exports = defineConfig({
  // Path to webpack loadable stats
  statsFile: 'public/packs/admin-loadable-stats.json',

  // Baseline configuration
  baselineDir: 'tmp/bundle_size',
  baselineFile: 'admin-config.json',

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
    controlDir: 'tmp/bundle_size_control',
  },

  // Baseline storage for --download/--upload (uses defaults)
  storage: {
    storageDir: 'baseline/bundle_size',
    mainCommitsToCheck: 10,
  },

  // Custom regression policy for admin app
  regressionPolicy: (regression) => {
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
        if (sizeDiffKb > threshold) {
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
