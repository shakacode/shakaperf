import type { RunnerResult } from 'lighthouse';

import { ensureLighthousePatchRegistered } from './register-patch';

// Loader hook has to be in place before Lighthouse's module graph loads.
// Registering here (module init) makes any later `await import('lighthouse')`
// pick up the patched `wait-for-condition.js`.
ensureLighthousePatchRegistered();

// Lighthouse v12+ is ESM-only. TypeScript's CJS emit would rewrite a
// top-level `import lighthouse from 'lighthouse'` into a plain `require()`,
// which throws ERR_REQUIRE_ESM at module load — even on code paths that
// never actually call Lighthouse (e.g. `shaka-perf init`). Dynamic-import
// at call-time keeps the CLI's other commands usable when Lighthouse isn't
// needed.
async function loadLighthouse(): Promise<(typeof import('lighthouse'))['default']> {
  const mod = await import('lighthouse');
  if (!(globalThis as { shakaPerfPatched?: boolean }).shakaPerfPatched) {
    // The patched wait-for-condition.js sets this flag on evaluation. If it's
    // unset after lighthouse loaded, the loader hook never matched our target
    // and lighthouse is running unpatched.
    throw new Error(
      '[shaka-perf] Lighthouse loaded without the shaka-perf patch. ' +
      'Check that patch-loader.mjs matched the lighthouse source paths.'
    );
  }
  return mod.default;
}

const HOLD_GATHER_FLAG = '__shakaperfHoldGather';

export interface RunPatchedLighthouseOptions {
  /**
   * A promise the caller fulfills when Lighthouse is free to stop
   * tracking. Until it settles, the patched Lighthouse keeps its driver
   * attached and its trace accumulating — so any interactions the caller
   * drives on the page in parallel are captured in the perf artifacts.
   *
   * Omit (or pass `Promise.resolve()`) to let Lighthouse finish on its
   * usual "page fully loaded" heuristics.
   *
   * The Lighthouse `maxWaitForLoadedMs` setting (default 45 s) still caps
   * the wait — a never-resolving promise can't wedge the run forever.
   */
  canStopTracking?: Promise<void>;
}

/**
 * Drive Lighthouse with optional "delayed stop tracking" support. Couples
 * three pieces behind one call:
 *   1. Ensures the ESM loader hook that patches Lighthouse's
 *      `waitForFullyLoaded` is registered (idempotent).
 *   2. Advertises the caller's `canStopTracking` promise on `globalThis`
 *      so the patched `waitForFullyLoaded` picks it up as an extra
 *      "page is fully loaded" signal.
 *   3. Invokes Lighthouse and cleans up the global when the run ends
 *      (even on failure).
 *
 * Everything delayed-stop-related lives inside this folder — the caller
 * just hands over a promise.
 *
 * Not safe to call concurrently in the same process: the canStopTracking
 * promise is advertised via a single `globalThis.__shakaperfHoldGather`
 * slot, so overlapping calls will cross-contaminate each other's traces.
 */
export async function runPatchedLighthouse(
  url: string,
  settings: unknown,
  { canStopTracking = Promise.resolve() }: RunPatchedLighthouseOptions = {},
): Promise<RunnerResult> {
  const g = globalThis as Record<string, unknown>;
  const hadPrevious = HOLD_GATHER_FLAG in g;
  const previous = g[HOLD_GATHER_FLAG];
  g[HOLD_GATHER_FLAG] = canStopTracking;
  try {
    const lighthouse = await loadLighthouse();
    const result = (await lighthouse(url, settings as never)) as RunnerResult;
    return result;
  } finally {
    if (hadPrevious) {
      g[HOLD_GATHER_FLAG] = previous;
    } else {
      delete g[HOLD_GATHER_FLAG];
    }
  }
}
