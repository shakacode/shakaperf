# shaka-bundle-size

Bundle size diffing and analysis tool for React and React on Rails apps using `@loadable/component`.

## Features

- Track gzip and brotli compressed bundle sizes
- Monitor chunk count per loadable component
- Detect size regressions with configurable thresholds
- Store and retrieve baselines from S3/Cloudflare R2
- Generate HTML diffs for visual comparison
- Generate source maps showing module composition
- Customizable regression policies

## Installation

```bash
npm install shaka-bundle-size
# or
yarn add shaka-bundle-size -D
```

## Quick Start

### 1. Create a configuration file

Create a `bundle-size.config.js` (or `.ts`) file in your project root:

```javascript
const { defineConfig } = require('shaka-bundle-size')

module.exports = defineConfig({
  statsFile: 'public/packs/loadable-stats.json',

  thresholds: {
    default: 10, // 10 KB for normal components
    keyComponents: ['HomePage'],
    keyComponentThreshold: 1, // 1 KB for key components
  },

  storage: {
    s3Bucket: 'my-bundle-size-bucket',
    s3Prefix: 'bundle-size/',
  },
})
```

### 2. Add npm scripts

```json
{
  "scripts": {
    "bundle-size:download": "shaka-bundle-size -c bundle-size.config.js --download-main-branch-stats",
    "bundle-size:compare": "shaka-bundle-size -c bundle-size.config.js --compare",
    "bundle-size:upload": "shaka-bundle-size -c bundle-size.config.js --upload-main-branch-stats"
  }
}
```

### 3. Run in CI

```bash
# On feature branches: download baseline and compare
yarn bundle-size:download
yarn bundle-size:compare

# On main branch after merge: upload new baseline
yarn bundle-size:upload
```

## CLI Usage

```bash
shaka-bundle-size [options]

Options:
  -c, --config <file>             Config file path (required)
  --download-main-branch-stats    Download baseline from main branch
  --compare                       Compare current build against baseline
  --upload-main-branch-stats      Upload baseline for current commit
  --commit <sha>                  Specific commit SHA
  --no-html-diffs                 Skip HTML diff generation
  -v, --verbose                   Verbose output
  -q, --quiet                     Quiet output (errors only)
  -h, --help                      Show help
  --version                       Show version
```

### Exit Codes

| Code | Meaning                             |
| ---- | ----------------------------------- |
| 0    | Success / Check passed              |
| 1    | Check failed (regressions detected) |
| 2    | Configuration or runtime error      |

## Configuration

### Full Configuration Reference

```typescript
import { defineConfig, RegressionType, type Regression } from 'shaka-bundle-size';

export default defineConfig({
  // Path to webpack loadable-stats.json (REQUIRED)
  statsFile: 'public/packs/loadable-stats.json',

  // Where to store baseline configs (default: 'tmp/bundle_size')
  baselineDir: 'tmp/bundle_size',

  // Baseline filename (auto-derived from statsFile if not set)
  baselineFile: 'baseline-config.json',

  // Size thresholds
  thresholds: {
    default: 10,                    // Max size increase in KB
    keyComponents: ['HomePage'],    // Critical component names
    keyComponentThreshold: 1,       // Stricter threshold for key components
  },

  // Bundles to ignore during comparison
  ignoredBundles: ['vendor', 'runtime'],

  // Branches where failures become warnings only
  ignoredBranches: ['renovate/*', 'dependabot/*'],

  // Generate bundle composition maps (default: true)
  generateSourceMaps: true,

  // HTML diff configuration
  htmlDiffs: {
    enabled: true,                           // Enable HTML diffs (default: true)
    outputDir: 'bundle-size-diffs',          // Where to output HTML files
    currentDir: 'tmp/bundle_size_current',   // Temp directory for current stats
  },

  // S3/R2 storage configuration
  storage: {
    s3Bucket: 'my-bucket',           // S3/R2 bucket name (REQUIRED)
    s3Prefix: 'bundle-size/',        // S3 key prefix
    awsRegion: 'us-east-1',          // AWS region (or 'auto' for R2)
    endpoint: undefined,             // Custom endpoint (for Cloudflare R2)
    mainCommitsToCheck: 10,          // Recent main commits to search
    mainBranch: 'main',              // Main branch name
  },

  // Custom regression policy (optional)
  regressionPolicy: (regression: Regression) => {
    // Return { shouldFail: boolean, message?: string }
  },
});
```

### TypeScript Configuration

TypeScript configs are fully supported:

```typescript
// bundle-size.config.ts
import { defineConfig, RegressionType, type Regression } from 'shaka-bundle-size';

export default defineConfig({
  statsFile: 'public/packs/admin-loadable-stats.json',

  thresholds: {
    default: 50,
    keyComponents: ['AdminDashboard'],
    keyComponentThreshold: 5,
  },

  storage: {
    s3Bucket: 'my-bucket',
    s3Prefix: 'bundle-size/',
  },

  regressionPolicy: (regression: Regression) => {
    const { componentName, type, sizeDiffKb } = regression;
    const isKeyComponent = ['AdminDashboard'].includes(componentName);
    const threshold = isKeyComponent ? 5 : 50;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        // Allow new components with a warning
        return { shouldFail: false };

      case RegressionType.REMOVED_COMPONENT:
        if (isKeyComponent) {
          return { shouldFail: true, message: 'Key component removed' };
        }
        break;

      case RegressionType.INCREASED_SIZE:
        if (sizeDiffKb !== undefined && sizeDiffKb > threshold) {
          return {
            shouldFail: true,
            message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB`
          };
        }
        break;

      case RegressionType.INCREASED_CHUNKS_COUNT:
        // Allow chunk increases with a warning
        return { shouldFail: false };
    }

    return { shouldFail: false };
  },
});
```

## Regression Types

| Type                     | Description                     |
| ------------------------ | ------------------------------- |
| `NEW_COMPONENT`          | New loadable component detected |
| `REMOVED_COMPONENT`      | Component removed from codebase |
| `INCREASED_SIZE`         | Component size increased        |
| `INCREASED_CHUNKS_COUNT` | More chunks than expected       |

## Storage Configuration

### AWS S3

```typescript
storage: {
  s3Bucket: 'my-bucket',
  awsRegion: 'us-east-1',
}
```

### Cloudflare R2

```typescript
storage: {
  s3Bucket: 'my-bucket',
  awsRegion: 'auto',
  endpoint: 'https://<account_id>.r2.cloudflarestorage.com',
}
```

### Environment Variables

| Variable                                           | Description                 |
| -------------------------------------------------- | --------------------------- |
| `AWS_REGION`                                       | AWS region                  |
| `AWS_ACCESS_KEY_ID`                                | AWS credentials             |
| `AWS_SECRET_ACCESS_KEY`                            | AWS credentials             |
| `S3_ENDPOINT`                                      | Custom S3 endpoint (for R2) |
| `CIRCLE_SHA1` / `GITHUB_SHA`                       | Current commit SHA          |
| `CIRCLE_BRANCH` / `GITHUB_REF_NAME` / `GIT_BRANCH` | Current branch              |

## Output Artifacts

### Baseline Config (JSON)

```json
{
  "loadableComponents": [
    {
      "name": "HomePage",
      "chunksCount": 2,
      "brotliSizeKb": "45.23",
      "gzipSizeKb": "52.15"
    }
  ],
  "totalgzipSizeKb": "125.67"
}
```

### Source Map (Text)

Shows hierarchical module breakdown per component:

```
HomePage
├── node_modules/react/index.js (2.5 KB)
├── src/pages/HomePage/index.tsx (1.2 KB)
└── src/components/Header/index.tsx (0.8 KB)
```

### HTML Diffs

Side-by-side comparison showing changes between baseline and current build.

## CI/CD Workflow

```
Feature Branch:
┌─────────────────────────────────────────────────────────┐
│ 1. Build webpack bundles                                │
│ 2. shaka-bundle-size --download-main-branch-stats       │
│    └─> Finds baseline for merge-base with main          │
│ 3. shaka-bundle-size --compare                          │
│    └─> Compares current build against baseline          │
│    └─> Generates HTML diffs                             │
│    └─> ✓ Pass or ✗ Fail based on policy                 │
└─────────────────────────────────────────────────────────┘

Main Branch (after merge):
┌─────────────────────────────────────────────────────────┐
│ 1. Build webpack bundles                                │
│ 2. shaka-bundle-size --upload-main-branch-stats         │
│    └─> Generates current stats                          │
│    └─> Uploads baseline to S3 for this commit           │
└─────────────────────────────────────────────────────────┘
```

## Programmatic API

```typescript
import {
  BundleSizeChecker,
  BaselineStorage,
  loadConfig,
  Reporter,
} from 'shaka-bundle-size'

// Load config
const config = await loadConfig('bundle-size.config.ts')

// Create checker
const reporter = new Reporter()
const checker = new BundleSizeChecker(config, reporter)

// Compare against baseline
const result = await checker.check()

if (result.hasFailures) {
  console.log('Regressions detected:', result.failures)
  process.exit(1)
}

// Or upload new baseline
await checker.updateBaseline()
```

### Available Exports

```typescript
// Configuration
export {
  defineConfig,
  resolveConfig,
  loadConfig,
  loadConfigSync,
} from 'shaka-bundle-size'

// Main classes
export { BundleSizeChecker } from 'shaka-bundle-size'
export { BaselineStorage } from 'shaka-bundle-size'
export { Reporter, SilentReporter } from 'shaka-bundle-size'

// Utilities
export { WebpackStatsReader } from 'shaka-bundle-size'
export { SizeCalculator } from 'shaka-bundle-size'
export { BaselineComparator } from 'shaka-bundle-size'
export { RegressionDetector, RegressionType } from 'shaka-bundle-size'
export { BaselineWriter } from 'shaka-bundle-size'
export { SourceMapGenerator } from 'shaka-bundle-size'
export { HtmlDiffGenerator } from 'shaka-bundle-size'

// Types
export type { BundleSizeConfig, Regression } from 'shaka-bundle-size'
```

## Multiple Bundle Configs

For apps with multiple bundles (e.g., consumer and admin), create separate config files:

```bash
# Download both baselines
shaka-bundle-size -c consumer.bundle-size.config.js --download-main-branch-stats
shaka-bundle-size -c admin.bundle-size.config.ts --download-main-branch-stats

# Compare both
shaka-bundle-size -c consumer.bundle-size.config.js --compare
shaka-bundle-size -c admin.bundle-size.config.ts --compare

# Upload both
shaka-bundle-size -c consumer.bundle-size.config.js --upload-main-branch-stats
shaka-bundle-size -c admin.bundle-size.config.ts --upload-main-branch-stats
```

Or combine in npm scripts:

```json
{
  "scripts": {
    "bundle-size:download": "shaka-bundle-size -c consumer.bundle-size.config.js --download-main-branch-stats && shaka-bundle-size -c admin.bundle-size.config.ts --download-main-branch-stats",
    "bundle-size:compare": "shaka-bundle-size -c consumer.bundle-size.config.js --compare && shaka-bundle-size -c admin.bundle-size.config.ts --compare",
    "bundle-size:upload": "shaka-bundle-size -c consumer.bundle-size.config.js --upload-main-branch-stats && shaka-bundle-size -c admin.bundle-size.config.ts --upload-main-branch-stats"
  }
}
```

## Requirements

- Node.js 18+
- Webpack build with `@loadable/webpack-plugin` generating `loadable-stats.json`
- S3-compatible storage (AWS S3 or Cloudflare R2)

## License

MIT
