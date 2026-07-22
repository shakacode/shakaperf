/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition, TestType } from 'shaka-shared';
import { resolveViewports, type AbTestsConfig, type Viewport } from '../config';
import { applyPerTestConfigOverrides } from '../effective-config';

/**
 * The viewports a test runs at for one stage category: apply the test's `config`
 * override, then resolve that category's viewport labels into `Viewport`
 * definitions — resolution stays downstream of the merge.
 */
export function resolveViewportsForTest(
  test: AbTestDefinition,
  fileConfig: AbTestsConfig,
  category: TestType,
): readonly Viewport[] {
  const effective = applyPerTestConfigOverrides(fileConfig, test);
  return resolveViewports(effective[category].viewports, effective.shared.viewports);
}
