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
// Inherited by forked workers so they skip the announcement — one line per
// `shaka-perf compare` invocation instead of one per worker × test × viewport.
const ANNOUNCE_ENV = 'SHAKA_PERF_PATCH_ANNOUNCED';

export function ensureLighthousePatchRegistered(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;

  const loaderPath = path.join(__dirname, 'patch-loader.mjs');
  register(pathToFileURL(loaderPath).href);
  g[FLAG] = true;

  if (!process.env[ANNOUNCE_ENV]) {
    console.log('[shaka-perf] lighthouse patched');
    process.env[ANNOUNCE_ENV] = '1';
  }
}
