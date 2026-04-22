import type { PerfConfig, SharedConfig } from "../../../compare/config";

export type RegressionThresholdStat = "estimator" | "ci-lower" | "ci-upper";
export type { SamplingMode } from "../../core/run";

/**
 * Legacy bench CLI config name. Retained for the `shaka-perf/bench`
 * subpath API; internally a `Partial` of the `perf` + `shared` slices of
 * `abtests.config.ts`, plus a small set of legacy-only CLI flags.
 *
 * New code should reach for `PerfConfig` / `SharedConfig` from
 * `shaka-perf/compare` instead.
 */
export type ITBConfig = Partial<PerfConfig> &
  Partial<SharedConfig> & {
    /** Legacy Lighthouse config file path. Prefer `PerfConfig.lhConfigPath`. */
    config?: string;
    /** Legacy report format flag. Unused post-unification. */
    report?: string;
    /** Allow opaque ad-hoc flag lookups via `getDefaultValue(name)`. */
    [key: string]: unknown;
  };
