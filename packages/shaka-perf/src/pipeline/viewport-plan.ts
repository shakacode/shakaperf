/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { testRunsForType, type AbTestDefinition, type TestType } from 'shaka-shared';
import { resolveViewports, type AbTestsConfig, type Viewport } from '../config';
import { applyPerTestConfigOverrides } from '../effective-config';
import type { Outcome } from './outcome';
import type { Stage } from '../stage/stage';

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

/**
 * Whether a persisted stage outcome is in scope for this test at this viewport
 * under the CURRENT config. Guards report assembly against stale on-disk
 * outcomes: unit dirs from earlier runs survive on disk, so after a test
 * narrows a category's viewports (or opts out of a category via `testTypes`)
 * the old units' `<stage>.json` files are still there — without this check the
 * report renders them as live results at viewports the category no longer runs
 * at. Skip markers always stay: they are written deliberately to explain a
 * stage's absence.
 */
export function persistedOutcomeInScope(
  test: AbTestDefinition,
  fileConfig: AbTestsConfig,
  stage: Stage | undefined,
  outcome: Outcome,
  viewportLabel: string,
): boolean {
  // A json for a stage the pipeline doesn't know — leave visible rather than
  // silently hide data we can't classify.
  if (!stage) return true;
  if (outcome.kind === 'skipped') return true;
  if (!testRunsForType(test, stage.category)) return false;
  return resolveViewportsForTest(test, fileConfig, stage.category)
    .some((vp) => vp.label === viewportLabel);
}
