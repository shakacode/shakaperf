/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ScreenshotCoveragePlugin } from 'shaka-shared';
import { react18ScreenshotCoveragePlugin } from './react18';
import { react19ScreenshotCoveragePlugin } from './react19';

export { react18ScreenshotCoveragePlugin } from './react18';
export type { React18SourcePluginOptions } from './react18';
export { react19ScreenshotCoveragePlugin } from './react19';
export type { React19SourcePluginOptions } from './react19';

const BUILT_IN = {
  react18: react18ScreenshotCoveragePlugin,
  react19: react19ScreenshotCoveragePlugin,
} as const;

export type BuiltInScreenshotCoveragePlugin = keyof typeof BUILT_IN;

// One instance per built-in per process, so a plugin's caches span the whole run.
const instances = new Map<BuiltInScreenshotCoveragePlugin, ScreenshotCoveragePlugin>();

export function resolveScreenshotCoveragePlugin(
  setting: BuiltInScreenshotCoveragePlugin | ScreenshotCoveragePlugin | undefined,
): ScreenshotCoveragePlugin | undefined {
  if (typeof setting !== 'string') return setting;
  let plugin = instances.get(setting);
  if (!plugin) {
    plugin = BUILT_IN[setting]();
    instances.set(setting, plugin);
  }
  return plugin;
}
