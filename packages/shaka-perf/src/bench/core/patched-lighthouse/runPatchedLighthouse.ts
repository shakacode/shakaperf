import type { RunnerResult } from 'lighthouse';

import { ensureLighthousePatchRegistered } from './register-patch';

// Must precede the `lighthouse` import below: registration side-effect
// installs the ESM loader hook that rewrites wait-for-condition.js in
// memory. In CJS emit, `require()` statements run in source order.
ensureLighthousePatchRegistered();

import lighthouse from 'lighthouse';

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
  canStopTracking?: Promise<unknown>;
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
