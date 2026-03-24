import { cpSync, rmSync } from 'node:fs';

// Clean stale compiled files from template directories before copying source .ts files
rmSync('dist/capture/ab-tests', { recursive: true, force: true });

const assets = [
  ['package.json', 'dist/package.json'],
  ['capture/resources', 'dist/capture/resources'],
  ['capture/config.default.ts', 'dist/capture/config.default.ts'],
  ['capture/ab-tests', 'dist/capture/ab-tests'],
  ['capture/helpers/imageStub.jpg', 'dist/capture/helpers/imageStub.jpg'],
  ['compare/output', 'dist/compare/output'],
];

for (const [src, dest] of assets) {
  cpSync(src, dest, { recursive: true });
}

console.log('Assets copied to dist/');
