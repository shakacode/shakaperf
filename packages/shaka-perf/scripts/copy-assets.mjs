import { cpSync, rmSync } from 'node:fs';

// Clean stale compiled files from template directories before copying source .ts files
rmSync('dist/visreg/capture/ab-tests', { recursive: true, force: true });

const assets = [
  // Visreg capture assets (source at src/visreg/capture/, dest follows tsc output at dist/visreg/capture/)
  ['src/visreg/capture/resources', 'dist/visreg/capture/resources'],
  ['src/visreg/capture/config.default.ts', 'dist/visreg/capture/config.default.ts'],
  ['src/visreg/capture/ab-tests', 'dist/visreg/capture/ab-tests'],
  ['src/visreg/capture/cookies', 'dist/visreg/capture/cookies'],
  ['src/visreg/capture/helpers/imageStub.jpg', 'dist/visreg/capture/helpers/imageStub.jpg'],
  // Pre-built single-file React report (Vite output)
  ['report-shell/dist/index.html', 'dist/report-shell/index.html'],
];

for (const [src, dest] of assets) {
  cpSync(src, dest, { recursive: true });
}

console.log('Assets copied to dist/');
