/**
 * Demo-Ecommerce Bundle Size Checker - Project-specific wrapper
 *
 * This module provides Demo-Ecommerce-specific configuration for the generic
 * bundle size checker library. It handles all hardcoded values, thresholds,
 * and policies specific to the Demo-Ecommerce codebase.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  BundleSizeChecker,
  Reporter,
  colorize,
  RegressionType,
} = require('shaka-bundle-size');

// ============================================================================
// Demo-Ecommerce-Specific Configuration
// ============================================================================

const BUNDLES_DIR = 'public/packs';
const BASELINE_DIR = 'tmp/bundle_size';

/**
 * All apps in the Demo-Ecommerce codebase.
 */
const ALL_APPS = [
  { name: 'admin', statsFile: 'admin-loadable-stats.json' },
  { name: 'consumer', statsFile: 'consumer-loadable-stats.json' },
];

/**
 * Consumer-only apps (for faster builds).
 */
const CONSUMER_ONLY_APPS = [
  { name: 'consumer', statsFile: 'consumer-loadable-stats.json' },
];

/**
 * Bundles to ignore during checking.
 */
const IGNORED_BUNDLES = [];

/**
 * Key components that have stricter thresholds.
 * These are the main entry points and any critical loadable components.
 */
const KEY_COMPONENTS = {
  admin: [
    'admin',  // main entry point
  ],
  consumer: [
    'HomePage',
  ],
};

/**
 * Thresholds per app.
 */
const THRESHOLDS = {
  admin: {
    keyComponentsThresholdKb: 5,
    minComponentSizeKb: 1,
    unimportantComponentsThresholdKb: 50,
  },
  consumer: {
    keyComponentsThresholdKb: 1,
    minComponentSizeKb: 1,
    unimportantComponentsThresholdKb: 10,
  },
};

/**
 * Documentation links.
 */
const DOC_LINKS = {
  loadableComponents: 'https://loadable-components.com/',
  resolvingErrors: 'https://github.com/your-org/demo-ecommerce/wiki/Bundle-Size-Errors',
};

/**
 * HTML diff generation configuration.
 */
const HTML_DIFF_CONFIG = {
  outputDir: 'bundle-size-diffs',
  controlDir: 'tmp/bundle_size_control',
  templatePath: path.join(__dirname, '../../../bundle_size/diff-template-for-ci-artifacts.html'),
};

// ============================================================================
// Demo-Ecommerce Regression Policy
// ============================================================================

/**
 * Checks if a component is a key component for an app.
 * @param {string} appName - Application name
 * @param {string} componentName - Component name
 * @returns {boolean} True if key component
 */
function isKeyComponent(appName, componentName) {
  const keyComponents = KEY_COMPONENTS[appName] || KEY_COMPONENTS.consumer;
  return keyComponents.includes(componentName);
}

/**
 * Gets threshold for a component.
 * @param {string} appName - Application name
 * @param {string} componentName - Component name
 * @returns {number} Threshold in KB
 */
function getThreshold(appName, componentName) {
  const thresholds = THRESHOLDS[appName] || THRESHOLDS.consumer;
  return isKeyComponent(appName, componentName)
    ? thresholds.keyComponentsThresholdKb
    : thresholds.unimportantComponentsThresholdKb;
}

/**
 * Demo-Ecommerce-specific regression policy.
 * @param {import('shaka-bundle-size').Regression} regression - Regression to evaluate
 * @returns {import('shaka-bundle-size').PolicyResult} Policy result
 */
function demoEcommerceRegressionPolicy(regression) {
  const { appName, componentName, type, sizeKb, sizeDiffKb } = regression;
  const threshold = getThreshold(appName, componentName);
  const isKey = isKeyComponent(appName, componentName);

  switch (type) {
    case RegressionType.NEW_COMPONENT:
      // Consumer app is stricter about new components
      if (appName === 'consumer') {
        console.log(colorize.red('New components on consumer require review for performance impact.'));
        return { shouldFail: true, message: 'Performance review required for new consumer component' };
      }
      break;

    case RegressionType.REMOVED_COMPONENT:
      if (isKey) {
        console.log(colorize.red('Do not remove or update a key component without updating the bundle size configuration.'));
        return { shouldFail: true, message: 'Key component removed' };
      }
      break;

    case RegressionType.INCREASED_SIZE:
      if (sizeDiffKb > threshold) {
        console.log(colorize.red(`The difference is larger than threshold ${threshold} KB. Consider introducing a new Loadable Component.`));
        if (isKey) {
          console.log(colorize.red(`Careful! "${componentName}" is a key component.`));
        }
        return { shouldFail: true, message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB` };
      }
      break;

    case RegressionType.INCREASED_CHUNKS_COUNT:
      if (appName === 'consumer') {
        console.log(colorize.red('Increasing chunks number means increased webpack and HTTP overhead. This may be bad for performance.'));
        return { shouldFail: true, message: 'Chunks count increased on consumer app' };
      }
      break;
  }

  // Not a failure - log as ignored minor change
  console.log(colorize.blue(`Ignored minor change in ${componentName}.`));
  return { shouldFail: false };
}

// ============================================================================
// Demo-Ecommerce Reporter
// ============================================================================

/**
 * Extended reporter with Demo-Ecommerce-specific output.
 */
class DemoEcommerceReporter extends Reporter {
  /**
   * Reports the final summary with Demo-Ecommerce-specific guidance.
   * @param {import('shaka-bundle-size').CheckResult} result - Check result
   */
  summary(result) {
    if (result.passed) {
      this.writeLine('');
      this.success('All bundle size checks passed!');
      return;
    }

    this.writeLine('');
    this.error('\n\n\nThe test failed!');
    this.info(`See ${this.color(DOC_LINKS.resolvingErrors, 'blue')}`);
    this.info(`\nTo get insight why the bundle size changed ${this.color('see Artifacts', 'green')} for this CI job`);

    this.info("\nIf the change is intended or if you don't know how to resolve the issue:");

    const ignoreCommands = result.failedApps.map(app => `bin/ci/ignore-bundle-size-change ${app}`);
    this.info(`    * run ${this.color(ignoreCommands.join(' && '), 'green')}`);
    this.info('    * Commit and push the changes to your branch.');

    this.info('\nThis will make bundle-size green and invite review from the following teams:');
    if (result.failedApps.includes('consumer')) {
      this.error('    @demo-ecommerce/performance');
    }
    if (result.failedApps.includes('admin')) {
      this.error('    @demo-ecommerce/architecture');
    }
  }
}

// ============================================================================
// Branch Ignore Logic
// ============================================================================

/**
 * Gets the ignore file path for an app.
 * @param {string} appName - Application name
 * @returns {string} Path to ignore file
 */
function getIgnoreFilePath(appName) {
  return path.join('lib', 'bundle_size', `ignore-bundle-size-${appName}.txt`);
}

/**
 * Checks if the current branch should be ignored for an app.
 * @param {string} appName - Application name
 * @param {string} branchName - Current branch name
 * @returns {boolean} True if branch is ignored
 */
function isBranchIgnored(appName, branchName) {
  const ignorePath = getIgnoreFilePath(appName);

  if (!fs.existsSync(ignorePath)) {
    return false;
  }

  const ignoredBranches = fs.readFileSync(ignorePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);

  return ignoredBranches.includes(branchName);
}

// ============================================================================
// HTML Diff Generation
// ============================================================================

/**
 * Copies the current baseline to a control directory for comparison.
 * @param {string} baselineDir - Source baseline directory
 * @param {string} controlDir - Destination control directory
 */
function copyBaselineToControl(baselineDir, controlDir) {
  // Remove existing control dir
  if (fs.existsSync(controlDir)) {
    fs.rmSync(controlDir, { recursive: true });
  }

  // Copy baseline to control
  if (fs.existsSync(baselineDir)) {
    fs.cpSync(baselineDir, controlDir, { recursive: true });
  }
}

/**
 * Installs diff2html-cli if not already available.
 */
function ensureDiff2HtmlInstalled() {
  try {
    execSync('which diff2html', { stdio: 'ignore' });
  } catch {
    console.log(colorize.blue('Installing diff2html-cli...'));
    execSync('npm install -g diff2html-cli', { stdio: 'inherit' });
  }
}

/**
 * Gets the main branch commit SHA for diff metadata.
 * @returns {string} Main commit SHA or empty string
 */
function getMainCommit() {
  try {
    return execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim().substring(0, 7);
  } catch {
    return '';
  }
}

/**
 * Generates HTML diff artifacts for CI.
 * @param {BundleSizeChecker} checker - Bundle size checker instance
 */
function generateHtmlDiffsForCI(checker) {
  const branchName = process.env.CIRCLE_BRANCH || process.env.GITHUB_REF_NAME || '';
  const currentCommit = (process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || '').substring(0, 7);
  const mainCommit = getMainCommit();

  console.log(colorize.green('\n\n\n\nGenerating *.diff.html Artifacts for this CI job'));

  // Step 1: Copy current baseline (from download) to control directory
  copyBaselineToControl(BASELINE_DIR, HTML_DIFF_CONFIG.controlDir);

  // Step 2: Update baseline with current build sizes
  checker.updateBaseline();

  // Step 3: Ensure diff2html is installed
  ensureDiff2HtmlInstalled();

  // Step 4: Generate HTML diffs
  checker.generateHtmlDiffs({
    controlDir: HTML_DIFF_CONFIG.controlDir,
    outputDir: HTML_DIFF_CONFIG.outputDir,
    templatePath: HTML_DIFF_CONFIG.templatePath,
    metadata: {
      masterCommit: mainCommit,
      branchName,
      currentCommit,
    },
  });
}

// ============================================================================
// Exit Status
// ============================================================================

const ExitStatus = {
  SUCCESS: 0,
  FAILURE: 1,
  IGNORED_FAILURE: 2,
};

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs the Demo-Ecommerce bundle size check.
 * @param {Object} options - Check options
 * @param {boolean} [options.update=false] - Update baseline instead of checking
 * @param {boolean} [options.consumerOnly=false] - Only check consumer app
 * @param {boolean} [options.skipSourceMaps=false] - Skip source map generation
 * @param {boolean} [options.skipHtmlDiffs=false] - Skip HTML diff generation
 * @returns {number} Exit status code
 */
function runDemoEcommerceBundleSizeCheck(options = {}) {
  const {
    update = false,
    consumerOnly = process.env.CONSUMER_BUNDLE_ONLY === 'true',
    skipSourceMaps = process.env.BUNDLE_SIZE_SKIP_STATS_GENERATION === 'true',
    skipHtmlDiffs = process.env.BUNDLE_SIZE_SKIP_STATS_GENERATION === 'true',
  } = options;

  const apps = consumerOnly ? CONSUMER_ONLY_APPS : ALL_APPS;
  const reporter = new DemoEcommerceReporter();

  const checker = new BundleSizeChecker({
    bundlesDir: BUNDLES_DIR,
    baselineDir: BASELINE_DIR,
    apps,
    defaultThreshold: {
      sizeIncreaseKb: 0.1,
    },
    ignoredBundles: IGNORED_BUNDLES,
    generateSourceMaps: !skipSourceMaps,
    regressionPolicy: demoEcommerceRegressionPolicy,
    reporter,
  });

  if (update) {
    checker.updateBaseline();
    return ExitStatus.SUCCESS;
  }

  const result = checker.check();

  // Generate HTML diffs for CI artifacts (after check, before returning)
  if (!skipHtmlDiffs) {
    generateHtmlDiffsForCI(checker);
  }

  if (result.passed) {
    return ExitStatus.SUCCESS;
  }

  // Check if any failed apps have the branch ignored
  const branchName = process.env.CIRCLE_BRANCH || process.env.GITHUB_REF_NAME || 'your-branch-name';

  for (const appName of result.failedApps) {
    if (isBranchIgnored(appName, branchName)) {
      console.log(`Ignoring ${branchName}`);
      return ExitStatus.IGNORED_FAILURE;
    }
  }

  return ExitStatus.FAILURE;
}

module.exports = {
  runDemoEcommerceBundleSizeCheck,
  ExitStatus,

  // Export configuration for testing/inspection
  ALL_APPS,
  CONSUMER_ONLY_APPS,
  KEY_COMPONENTS,
  THRESHOLDS,
  DOC_LINKS,
  IGNORED_BUNDLES,
  HTML_DIFF_CONFIG,

  // Export helper functions
  isKeyComponent,
  getThreshold,
  demoEcommerceRegressionPolicy,
  isBranchIgnored,
  getIgnoreFilePath,
  copyBaselineToControl,
  ensureDiff2HtmlInstalled,
  getMainCommit,
  generateHtmlDiffsForCI,

  // Export classes
  DemoEcommerceReporter,
};
