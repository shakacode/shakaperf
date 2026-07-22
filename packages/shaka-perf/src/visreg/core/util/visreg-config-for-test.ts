/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import { mergePerTestSection } from '../../../per-test-config';

/**
 * The comparison tuning the visreg engine reads per scenario, resolved from the
 * effective config (file defaults + this test's `config.visreg` override) — the
 * SAME "per-test overlay over the file config" shape accessibility resolves via
 * `accessibilityConfigForTest`. Per-test overrides live on `test.config.visreg`
 * (a partial of the config file's `visreg` section); nothing tuning-related is
 * carried on the Scenario itself.
 *
 * `compareRetries` / `compareRetryDelay` are intentionally absent: best-of-N is
 * a run-level loop and `PerTestConfig` forbids overriding them per test, so they
 * are read straight off the file config at the retry loop.
 */
export interface VisregComparisonConfig {
  misMatchThreshold: number;
  requireSameDimensions: boolean;
  maxNumDiffPixels: number;
  comparePixelmatchThreshold: number;
}

/**
 * The file-config fields the merge falls back to. A subset of the decorated
 * engine config, kept structural so both `DecoratedCompareConfig` and the
 * lighter engine-bridge config satisfy it.
 */
export interface VisregComparisonConfigDefaults {
  misMatchThreshold?: number;
  defaultMisMatchThreshold?: number;
  requireSameDimensions?: boolean;
  defaultRequireSameDimensions?: boolean;
  maxNumDiffPixels?: number;
  comparePixelmatchThreshold?: number;
}

/** The visreg section shape both the file config and `config.visreg` speak. */
interface VisregSection {
  defaultMisMatchThreshold?: number;
  requireSameDimensions?: boolean;
  maxNumDiffPixels?: number;
  comparePixelmatchThreshold?: number;
}

/**
 * Resolve the effective comparison tuning for one test through the SAME uniform
 * overlay every category uses (`mergePerTestSection`): the test's `config.visreg`
 * section replaces the file defaults key-by-key, then the built-in defaults fill
 * any gap. This is the single source of per-test comparison values — engine reads
 * go through here instead of ad-hoc `scenario.X ?? config.X` pairs.
 */
export function visregComparisonForTest(
  config: VisregComparisonConfigDefaults | undefined,
  test: AbTestDefinition | undefined,
): VisregComparisonConfig {
  const fileSection: VisregSection = {
    defaultMisMatchThreshold: config?.misMatchThreshold ?? config?.defaultMisMatchThreshold,
    requireSameDimensions: config?.requireSameDimensions ?? config?.defaultRequireSameDimensions,
    maxNumDiffPixels: config?.maxNumDiffPixels,
    comparePixelmatchThreshold: config?.comparePixelmatchThreshold,
  };
  const merged = mergePerTestSection<VisregSection>(fileSection, test?.config?.visreg);
  return {
    misMatchThreshold: merged.defaultMisMatchThreshold ?? 0.1,
    requireSameDimensions: merged.requireSameDimensions ?? true,
    maxNumDiffPixels: merged.maxNumDiffPixels ?? 0,
    comparePixelmatchThreshold: merged.comparePixelmatchThreshold ?? 0.1,
  };
}
