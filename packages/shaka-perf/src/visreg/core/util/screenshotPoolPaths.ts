/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';

export function screenshotPoolPaths(unitArtifactsDir: string) {
  // Plural: each dir holds many frames accumulated across comparison attempts.
  return {
    controlScreenshotDir: path.join(unitArtifactsDir, 'control_screenshots'),
    experimentScreenshotDir: path.join(unitArtifactsDir, 'experiment_screenshots'),
  };
}
