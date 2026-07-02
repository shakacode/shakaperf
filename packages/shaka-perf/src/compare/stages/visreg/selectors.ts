/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { VisregResult } from '../visreg';

export function hasVisualChange(measurement: VisregResult): boolean {
  return measurement.some((artifact) => artifact.diffImage !== null);
}

export function visualChangeCount(measurement: VisregResult | null | undefined): number {
  return measurement?.filter((artifact) => artifact.diffImage !== null).length ?? 0;
}

export function hasSavedByRetries(measurement: VisregResult): boolean {
  return measurement.some((artifact) => artifact.savedByRetries);
}
