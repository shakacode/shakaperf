import { cpSync, rmSync } from 'node:fs';

// Clean stale compiled files from playwright template directory before copying source .ts files
rmSync('dist/capture/engine_scripts/playwright', { recursive: true, force: true });

const assets = [
  ['package.json', 'dist/package.json'],
  ['capture/resources', 'dist/capture/resources'],
  ['capture/config.default.json', 'dist/capture/config.default.json'],
  ['capture/engine_scripts/imageStub.jpg', 'dist/capture/engine_scripts/imageStub.jpg'],
  ['capture/engine_scripts/cookies.json', 'dist/capture/engine_scripts/cookies.json'],
  ['capture/engine_scripts/tsconfig.json', 'dist/capture/engine_scripts/tsconfig.json'],
  ['capture/engine_scripts/playwright', 'dist/capture/engine_scripts/playwright'],
  ['compare/output', 'dist/compare/output'],
];

for (const [src, dest] of assets) {
  cpSync(src, dest, { recursive: true });
}

console.log('Assets copied to dist/');
