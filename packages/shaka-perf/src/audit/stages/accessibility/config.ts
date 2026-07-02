/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestAccessibilityConfig, AbTestDefinition } from 'shaka-shared';
import type { AccessibilityConfig } from '../../../config';
import { DEFAULT_ACCESSIBILITY_TAGS } from './defaults';

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
  skip: boolean;
}

export function accessibilityConfigForTest(
  global: AccessibilityStageConfig,
  test: AbTestDefinition,
): AccessibilityEffectiveConfig {
  return mergeAccessibilityConfig(global, test.options.accessibility);
}

export function mergeAccessibilityConfig(
  global: AccessibilityStageConfig,
  perTest: AbTestAccessibilityConfig | undefined,
): AccessibilityEffectiveConfig {
  const tags = perTest?.tags ?? global.tags;
  const disableRules = dedup([
    ...(global.disableRules ?? []),
    ...(perTest?.disableRules ?? []),
  ]);
  const includeRules = perTest?.includeRules
    ? [...perTest.includeRules]
    : global.includeRules
      ? [...global.includeRules]
      : null;
  return {
    tags: [...tags],
    disableRules,
    includeRules,
    skip: perTest?.skip === true,
  };
}

function dedup<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
