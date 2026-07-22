/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition, TestType } from 'shaka-shared';
import type { Viewport } from '../config';

/**
 * The viewports a test runs at for one stage category, honouring a per-test
 * `config.<category>.viewports` override. The override is a label allow-list
 * that narrows the category's configured viewports (it can drop labels, never
 * add ones the file config didn't define); absent, the test runs every
 * configured viewport for that category.
 */
export function resolveViewportsForTest(
  test: AbTestDefinition,
  categoryViewports: readonly Viewport[],
  category: TestType,
): Viewport[] {
  const narrow = test.config?.[category]?.viewports;
  if (!narrow || narrow.length === 0) return [...categoryViewports];
  const narrowSet = new Set(narrow);
  return categoryViewports.filter((v) => narrowSet.has(v.label));
}
