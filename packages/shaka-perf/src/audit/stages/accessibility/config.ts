/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition, PerTestConfig } from 'shaka-shared';
import { mergePerTestSection } from '../../../per-test-config';
import type { AccessibilityConfig } from '../../../config';
import { DEFAULT_ACCESSIBILITY_TAGS } from './defaults';

/** The `accessibility` slice of a test's per-test `config` override. */
type PerTestAccessibility = PerTestConfig['accessibility'];

export interface AccessibilityStageConfig extends Omit<AccessibilityConfig, 'viewports'> {}

export const DEFAULT_ACCESSIBILITY_STAGE_CONFIG: AccessibilityStageConfig = {
  tags: [...DEFAULT_ACCESSIBILITY_TAGS],
  disableRules: [],
  includeRules: undefined,
  engineOptions: {
    browser: 'chromium',
    args: ['--no-sandbox'],
  },
  failOnViolation: true,
};

export interface AccessibilityEffectiveConfig {
  tags: string[];
  disableRules: string[];
  includeRules: string[] | null;
}

export function accessibilityConfigForTest(
  global: AccessibilityStageConfig,
  test: AbTestDefinition,
): AccessibilityEffectiveConfig {
  return mergeAccessibilityConfig(global, test.config?.accessibility);
}

export function mergeAccessibilityConfig(
  global: AccessibilityStageConfig,
  perTest: PerTestAccessibility | undefined,
): AccessibilityEffectiveConfig {
  // Same uniform overlay every category uses: a defined per-test list REPLACES
  // the file's wholesale (disableRules included — it is not unioned).
  const fileSection: AccessibilityEffectiveConfig = {
    tags: [...global.tags],
    disableRules: [...(global.disableRules ?? [])],
    includeRules: global.includeRules ? [...global.includeRules] : null,
  };
  const override: Partial<AccessibilityEffectiveConfig> = {};
  if (perTest?.tags !== undefined) override.tags = [...perTest.tags];
  if (perTest?.disableRules !== undefined) override.disableRules = [...perTest.disableRules];
  if (perTest?.includeRules !== undefined) override.includeRules = [...perTest.includeRules];
  return mergePerTestSection(fileSection, override);
}
