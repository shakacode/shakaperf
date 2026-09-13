/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestsConfig } from '../config';
import type { PipelineWorkerPool } from './pipeline';
import type { TaskLimits } from './worker-pool';

/**
 * Builds the `config -> TaskLimits` mapping for one worker pool in one run.
 *
 * `shared.timeoutMs` / `retries` / `retryDelay` are per-test overridable like
 * every other `shared` key, so the returned function reads them off WHICHEVER
 * config it is handed — the file config for the pool's own default, a unit's
 * effective config for that unit's tasks. Both go through this one function, so
 * the two can't drift apart, and no knob is special-cased: making a new budget
 * per-test overridable is a field on `TaskLimits` and a field on the schema,
 * and nothing here changes.
 *
 * Two things outrank a test, and both are layered on last because neither is a
 * statement about the test: the POOL's own `limits`, a fact about what that
 * pool's tasks may do at all (`troubleshoot` freezes its browsers), and
 * `--burn`, whose contract is that an instance's raw outcome IS the
 * measurement — no retry may mask a failure. `burn` arrives as the count
 * rather than as the run options that carry it: the run mode's other duties
 * (expanding each test into n instances, zeroing a stage's own retry loops)
 * are the runner's and the stages', and none of them belong to this seam.
 */
export function taskLimitsResolver(
  pool: PipelineWorkerPool,
  burn: number | null | undefined,
): (config: AbTestsConfig) => TaskLimits {
  const forced: Partial<TaskLimits> = {
    ...pool.limits,
    ...(burn == null ? {} : { retries: 0 }),
  };
  // `??`, not a spread: an explicit `undefined` in a pool's `limits` means "I'm
  // not overriding this", never "clobber the config". `Partial<TaskLimits>`
  // admits the former and this repo does not enable `exactOptionalPropertyTypes`,
  // and a spread would let it win — `undefined <= 0` is false, so the timeout
  // would fire on the next tick, and `n > undefined` is false, so the retry
  // budget would never run out.
  return (config) => {
    const { timeoutMs, retries, retryDelay } = config.shared;
    return {
      timeoutMs: forced.timeoutMs ?? timeoutMs,
      retries: forced.retries ?? retries,
      retryDelay: forced.retryDelay ?? retryDelay,
    };
  };
}
