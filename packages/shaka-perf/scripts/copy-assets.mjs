import { cpSync, statSync } from 'node:fs';

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
  [
    'src/bench/core/patched-lighthouse/lighthouse.patch',
    'dist/bench/core/patched-lighthouse/lighthouse.patch',
  ],
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
