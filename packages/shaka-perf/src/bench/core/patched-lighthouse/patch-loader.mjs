// ESM module loader hook that applies `lighthouse.patch` to Lighthouse's
// `core/gather/driver/wait-for-condition.js` in memory, the first time
// Node resolves that file. The consumer's `node_modules/lighthouse` stays
// untouched on disk.
//
// Patch format: standard unified diff (the kind `patch-package` or
// `git diff` emits). Keeping the change as a real `.patch` file rather
// than a string-replace in JS keeps the delta human-readable and lets us
// regenerate it with `yarn patch-package lighthouse` during dev.
//
// The applied hunk teaches `waitForFullyLoaded` to also wait on
// `globalThis.__shakaperfHoldGather`. shaka-perf's bench harness sets that
// global to the playwright testFn promise and releases it when testFn
// settles, so the Lighthouse driver stays attached and the trace keeps
// accumulating until testFn finishes. `maxWaitForLoadedMs` caps the wait.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyPatch } from 'diff';

const TARGET_SUFFIX = '/lighthouse/core/gather/driver/wait-for-condition.js';
const PATCH_PATH = fileURLToPath(new URL('./lighthouse.patch', import.meta.url));

let cachedPatch = null;
let warnedBadPatch = false;

function readPatch() {
  if (cachedPatch !== null) return cachedPatch;
  cachedPatch = readFileSync(PATCH_PATH, 'utf8');
  return cachedPatch;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith(TARGET_SUFFIX)) return result;

  const original =
    typeof result.source === 'string'
      ? result.source
      : Buffer.from(result.source ?? []).toString('utf8');

  const patched = applyPatch(original, readPatch());
  if (patched === false) {
    if (!warnedBadPatch) {
      warnedBadPatch = true;
      console.warn(
        '[shaka-perf] lighthouse.patch no longer applies to this lighthouse ' +
          'version. Perf tests will run, but testFn interactions after load ' +
          'will not be measured.',
      );
    }
    return result;
  }

  return { ...result, source: patched, shortCircuit: true };
}
