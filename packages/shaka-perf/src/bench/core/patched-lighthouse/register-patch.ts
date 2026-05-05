import { register } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Register — once per process — an ESM loader hook that rewrites selected
 * Lighthouse modules in memory when Node first resolves them. The consumer's
 * `node_modules/lighthouse` stays untouched on disk.
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
    // console.warn (stderr) — advisory notice, not an error. Keeps the banner
    // out of `$(shaka-perf …)` command substitution, which only captures stdout
    // (e.g. CI's `DOCKERFILE=$(shaka-perf twins-get-config dockerfile)`).
    console.warn('[shaka-perf] lighthouse patched');
    process.env[ANNOUNCE_ENV] = '1';
  }
}
