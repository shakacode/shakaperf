/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestsConfig } from '../config';

export const VIEWPORT_OPTION_DESCRIPTION =
  'Measure only this label from shared.viewportDefinitions, intersected with each test’s viewports. Preserve other viewport results. Ignored for report contents with --report-only.';

export function selectedViewportFilter(
  label: string | undefined,
  config: AbTestsConfig,
): readonly string[] | undefined {
  if (label === undefined) return undefined;
  const valid = config.shared.viewportDefinitions.map((viewport) => viewport.label);
  if (!valid.includes(label)) {
    throw new Error(`Unknown viewport "${label}". Valid labels: ${valid.join(', ')}.`);
  }
  return [label];
}
