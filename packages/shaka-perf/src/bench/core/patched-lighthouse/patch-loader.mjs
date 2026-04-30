// ESM module loader hook that applies shaka-perf patches to Lighthouse in
// memory, the first time Node resolves each target file. The consumer's
// `node_modules/lighthouse` stays untouched on disk.
//
// Patch format: standard unified diff (git diff style), kept as a real
// `.patch` file so the delta stays human-readable.
//
// The applied hunk teaches `waitForFullyLoaded` to also wait on
// `globalThis.__shakaperfHoldGather`. shaka-perf's bench harness sets that
// global to the playwright testFn promise and releases it when testFn
// settles, so the Lighthouse driver stays attached and the trace keeps
// accumulating until testFn finishes. `maxWaitForLoadedMs` caps the wait.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch } from 'diff';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));

const cachedPatches = new Map();
let cachedPatchTargets = null;

function targetSuffixFromPatch(patchPath) {
  const patch = readPatch(patchPath);
  const target = patch.match(/^\+\+\+ b\/(\S+)$/m)?.[1];
  if (!target) {
    throw new Error(`[shaka-perf] Could not find target file in Lighthouse patch: ${patchPath}`);
  }
  return `/lighthouse/${target}`;
}

function patchTargets() {
  if (cachedPatchTargets) return cachedPatchTargets;

  cachedPatchTargets = readdirSync(PATCH_DIR)
    .filter((entry) => entry.endsWith('.patch'))
    .map((entry) => {
      const patchPath = join(PATCH_DIR, entry);
      return {
        patchPath,
        targetSuffix: targetSuffixFromPatch(patchPath),
      };
    });

  return cachedPatchTargets;
}

function readPatch(patchPath) {
  const cached = cachedPatches.get(patchPath);
  if (cached !== undefined) return cached;
  const patch = readFileSync(patchPath, 'utf8');
  cachedPatches.set(patchPath, patch);
  return patch;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const pathname = new URL(url).pathname;
  const patchEntry = patchTargets().find(({ targetSuffix }) => pathname.endsWith(targetSuffix));
  if (!patchEntry) return result;
  const { targetSuffix, patchPath } = patchEntry;

  const original =
    typeof result.source === 'string'
      ? result.source
      : Buffer.from(result.source ?? []).toString('utf8');

  const patched = applyPatch(original, readPatch(patchPath));
  if (patched === false) {
    // Fail loud on drift. A silent no-op would mean testFn interactions
    // after load are excluded from the trace — invisible perf regression.
    throw new Error(
      '[shaka-perf] Lighthouse patch no longer applies to this lighthouse version. ' +
        `Target file: ${targetSuffix}. Regenerate the patch against the current ` +
        'lighthouse source under packages/shaka-perf/src/bench/core/patched-lighthouse/.',
    );
  }
  // The per-invocation announcement lives in `ensureLighthousePatchRegistered`
  // (main process) so one perf run prints one "[shaka-perf] lighthouse patched"
  // line instead of one per forked worker × test × viewport.
  return { ...result, source: patched, shortCircuit: true };
}
