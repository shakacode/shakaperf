import { register } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Register — once per process — an ESM loader hook that rewrites
 * Lighthouse's `core/gather/driver/wait-for-condition.js` in memory when
 * Node first resolves it. The consumer's `node_modules/lighthouse` stays
 * untouched on disk.
 *
 * Requires Node >= 20.6 (see shaka-perf package.json `engines`).
 */
const FLAG = '__shakaperfPatchRegistered';

export function ensureLighthousePatchRegistered(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;

  const loaderPath = path.join(__dirname, 'patch-loader.mjs');
  register(pathToFileURL(loaderPath).href);
  g[FLAG] = true;
}
