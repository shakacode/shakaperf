/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ScreenshotCoveragePlugin } from 'shaka-shared';
import { react19ScreenshotCoveragePlugin } from './react19';

export { react19ScreenshotCoveragePlugin } from './react19';
export type { React19SourcePluginOptions } from './react19';

// One instance per process, so its source-map cache spans the whole run.
let builtIn: ScreenshotCoveragePlugin | undefined;

export function resolveScreenshotCoveragePlugin(
  setting: 'react19' | ScreenshotCoveragePlugin | undefined,
): ScreenshotCoveragePlugin | undefined {
  if (setting !== 'react19') return setting;
  builtIn ??= react19ScreenshotCoveragePlugin();
  return builtIn;
}
