/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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
}
