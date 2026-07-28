/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import temp from 'temp';
import type { RuntimeConfig, VisregConfig } from '../types';

function extendConfig (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  artifactPaths(config, userConfig);
  tempCompareConfigPath(config);

  config.viewports = userConfig.viewports || [];
  // The effective value the compare stage wrote into the bridge config
  // (`config.visreg` with the per-test override already merged) — never a
  // hardcoded constant, or per-test/file tuning is silently ignored.
  config.mismatchThreshold = userConfig.mismatchThreshold ?? 0.1;
  config.resembleOutputOptions = userConfig.resembleOutputOptions;
  config.asyncCompareLimit = userConfig.asyncCompareLimit;

  config.compareRetries = userConfig.compareRetries ?? 0;
  config.compareRetryDelay = userConfig.compareRetryDelay ?? 5000;
  config.maxNumDiffPixels = userConfig.maxNumDiffPixels ?? 0;

  return config;
}

/**
 * Everything this invocation writes lives under `paths.artifacts` — the dir the
 * caller pinned. Derived here, not negotiated field by field: the caller says
 * WHERE, the engine owns the layout beneath it.
 *
 * The config crosses a serialize boundary (the compare stage writes a temp .js
 * module that's `require`d back and cast), so the type is a promise the
 * compiler can't keep — hence the runtime check. It throws rather than
 * defaulting: a fallback here silently scatters a unit's output somewhere the
 * caller isn't reading, which reads as "produced no artifacts".
 */
function artifactPaths (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const artifacts = userConfig.paths?.artifacts;
  if (typeof artifacts !== 'string' || artifacts.length === 0) {
    throw new Error(
      'visreg engine: no paths.artifacts provided. The unified compare runner ' +
      '(shaka-perf compare) pins the dir to write into — call the engine ' +
      'through that entry point.',
    );
  }
  config.unitArtifactsDir = artifacts;
  // Plural: each dir holds MANY frames per comparison (the crash-resumable
  // accumulation), not one.
  config.controlScreenshotDir = path.join(artifacts, 'control_screenshots');
  config.experimentScreenshotDir = path.join(artifacts, 'experiment_screenshots');
}

function tempCompareConfigPath (config: Partial<RuntimeConfig>) {
  config.tempCompareConfigFileName = temp.path({ suffix: '.json' });
}

export default extendConfig;
