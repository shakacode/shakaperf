/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PerfConfig, SharedConfig } from "../../../config";

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
export type { SamplingMode } from "../../core/run";

/**
 * Bench-CLI flag shape — a `Partial` of the `perf` + `shared` slices of
 * `abtests.config.ts`, plus engine-internal fields (Lighthouse config
 * path, etc.). Re-exported from the `shaka-perf/bench` subpath for
 * programmatic callers; end users should author `abtests.config.ts`
 * instead, which the compare runner converts into this type for the
 * bench engine.
 */
export type ITBConfig = Partial<PerfConfig> &
  Partial<SharedConfig> & {
    /** Path to the Lighthouse config file written by the compare bridge. */
    config?: string;
    /** Allow opaque ad-hoc flag lookups via `getDefaultValue(name)`. */
    [key: string]: unknown;
  };
