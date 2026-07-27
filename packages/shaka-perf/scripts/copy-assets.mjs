/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { cpSync, readdirSync, rmSync, statSync } from 'node:fs';

const srcPatches = readdirSync('src/bench/core/patched-lighthouse')
  .filter((entry) => entry.endsWith('.patch'));

// Remove dist patches whose src counterpart is gone. The patch loader applies
// every .patch file it finds next to itself, so a stale leftover in dist keeps
// rewriting Lighthouse long after the patch was deleted from src.
let distPatches = [];
try {
  distPatches = readdirSync('dist/bench/core/patched-lighthouse').filter((entry) => entry.endsWith('.patch'));
} catch {
  // dist not built yet
}
for (const stale of distPatches.filter((entry) => !srcPatches.includes(entry))) {
  rmSync(`dist/bench/core/patched-lighthouse/${stale}`);
  console.warn(`Removed stale Lighthouse patch from dist: ${stale}`);
}

const lighthousePatchAssets = srcPatches
  .map((entry) => [
    `src/bench/core/patched-lighthouse/${entry}`,
    `dist/bench/core/patched-lighthouse/${entry}`,
  ]);

const assets = [
  // Visreg capture assets (source at src/visreg/capture/, dest follows tsc output at dist/visreg/capture/)
  ['src/visreg/capture/resources', 'dist/visreg/capture/resources'],
  ['src/visreg/capture/helpers/imageStub.jpg', 'dist/visreg/capture/helpers/imageStub.jpg'],
  // Pre-built single-file React report (Vite output)
  ['report-shell/dist/index.html', 'dist/report-shell/index.html'],
  // Bench HTML report templates (Handlebars + Chart.js assets)
  ['src/bench/cli/static', 'dist/bench/cli/static'],
  [
    'src/bench/core/patched-lighthouse/patch-loader.mjs',
    'dist/bench/core/patched-lighthouse/patch-loader.mjs',
  ],
  // Standalone accessibility-score runner, spawned by the audit stage to score
  // a11y with vanilla (unpatched) Lighthouse - see the file header for why.
  [
    'src/audit/stages/audit/accessibility-score-runner.mjs',
    'dist/audit/stages/audit/accessibility-score-runner.mjs',
  ],
  // ESM resolve hook that lets user config/test files use extensionless / `.js`
  // relative imports (registered by the config-loader before tsImport).
  [
    'src/config-loader/resolve-ts-extensions.mjs',
    'dist/config-loader/resolve-ts-extensions.mjs',
  ],
  ...lighthousePatchAssets,
  // Bundled Claude Code skills — `shaka-perf init` copies these into the
  // user's project at .claude/skills/<name>/. Source of truth lives at the
  // repo-root .claude/ dir so they're also active in this repo.
  ['../../.claude/skills/discover-abtests', 'dist/skills/discover-abtests'],
  ['../../.claude/skills/setup-docker-servers-for-ab-tests', 'dist/skills/setup-docker-servers-for-ab-tests'],
  ['../../.claude/skills/assess-abtest-quality', 'dist/skills/assess-abtest-quality'],
  ['../../.claude/skills/ab-servers', 'dist/skills/ab-servers'],
];

for (const [src, dest] of assets) {
  cpSync(src, dest, { recursive: true });
}

// Postcondition: every declared asset must now exist at its dest. Fail loud
// at build time rather than as a cryptic runtime ENOENT later.
const missing = assets.filter(([, dest]) => {
  try {
    statSync(dest);
    return false;
  } catch {
    return true;
  }
});
if (missing.length > 0) {
  console.error('Assets failed to copy:');
  for (const [src, dest] of missing) {
    console.error(`  ${src} → ${dest}`);
  }
  process.exit(1);
}

console.log('Assets copied to dist/');
