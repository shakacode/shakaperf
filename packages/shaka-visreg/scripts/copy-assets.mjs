import { cpSync } from 'node:fs';

const assets = [
  ['package.json', 'dist/package.json'],
  ['capture/resources', 'dist/capture/resources'],
  ['capture/config.default.json', 'dist/capture/config.default.json'],
  ['capture/engine_scripts/imageStub.jpg', 'dist/capture/engine_scripts/imageStub.jpg'],
  ['capture/engine_scripts/cookies.json', 'dist/capture/engine_scripts/cookies.json'],
  ['compare/output', 'dist/compare/output'],
  ['remote', 'dist/remote'],
];

for (const [src, dest] of assets) {
  cpSync(src, dest, { recursive: true });
}

console.log('Assets copied to dist/');
