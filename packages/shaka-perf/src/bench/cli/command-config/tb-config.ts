import type { PerfConfig, SharedConfig } from "../../../compare/config";

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
export type { SamplingMode } from "../../core/run";

/**
 * Internal bench-CLI flag shape — a `Partial` of the `perf` + `shared`
 * slices of `abtests.config.ts`, plus engine-internal fields
 * (Lighthouse config path, etc.). Not user-facing; users author
 * `abtests.config.ts`, the compare runner derives this type for the
 * bench engine.
 */
export type ITBConfig = Partial<PerfConfig> &
  Partial<SharedConfig> & {
    /** Path to the Lighthouse config file written by the compare bridge. */
    config?: string;
    /** Allow opaque ad-hoc flag lookups via `getDefaultValue(name)`. */
    [key: string]: unknown;
  };
