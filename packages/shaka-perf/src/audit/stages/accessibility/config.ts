/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AccessibilityConfig, PlaywrightOptions } from '../../../config';
import { DEFAULT_ACCESSIBILITY_TAGS } from './defaults';

export interface AccessibilityStageConfig extends Omit<AccessibilityConfig, 'viewports'> {
  /**
   * File-level LAUNCH options for this stage — `resolvePlaywrightOptions(config,
   * 'accessibility')` (i.e. `shared.playwrightOptions`; accessibility has no
   * category override), handed in by the pipeline builder. Launch-only: the
   * browser is launched once per worker slot and reused, so `browser`/`args`/
   * `headless` can't vary per-test. The per-scan context/navigation/timeout
   * options (`ignoreHTTPSErrors`, `waitTimeout`, `gotoParameters`) are re-resolved
   * from the PER-TEST effective config in `scanAccessibilityPage`, consistent
   * with `beforeNavigate`.
   */
  playwrightOptions: PlaywrightOptions;
}

// No `playwrightOptions` here: launch options have no hidden defaults — the
// pipeline builder always hands in the resolved `shared.playwrightOptions`.
export const DEFAULT_ACCESSIBILITY_STAGE_CONFIG: Omit<AccessibilityStageConfig, 'playwrightOptions'> = {
  tags: [...DEFAULT_ACCESSIBILITY_TAGS],
  disableRules: [],
  includeRules: undefined,
  failOnViolation: true,
};

export interface AccessibilityEffectiveConfig {
  tags: string[];
  disableRules: string[];
  includeRules: string[] | null;
}
