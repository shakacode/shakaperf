/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { testRunsForType, type AbTestDefinition, type TestType } from 'shaka-shared';
import { viewportsForCategory, type AbTestsConfig, type Viewport } from '../config';
import { applyPerTestConfigOverrides } from '../effective-config';
import type { Outcome } from './outcome';
import type { Stage } from '../stage/stage';

/**
 * The viewports a test runs at for one stage category: apply the test's `config`
 * override, then resolve that category's viewport labels into `Viewport`
 * definitions. Both the `shared.viewports` fallback and the label resolution
 * stay downstream of the merge — that ordering is what lets a per-test
 * `config.shared.viewports` reach a category the file config left unset.
 */
export function resolveViewportsForTest(
  test: AbTestDefinition,
  fileConfig: AbTestsConfig,
  category: TestType,
): readonly Viewport[] {
  return viewportsForCategory(applyPerTestConfigOverrides(fileConfig, test), category);
}

/**
 * Every viewport this test has work at across `stages`: the union of each
 * stage category's per-test-narrowed viewports, skipping categories the test
 * opted out of via `testTypes`.
 *
 * ONE function for both the work plan and the report's row set, because the
 * two must agree. They didn't: the report used to union every stage's
 * viewports without the `testRunsForType` check, so a test that opted out of a
 * category still got rows at that category's viewports. With
 * `testTypes: ['visreg']` (which `withMandatoryTestTypes` widens to
 * `['visreg', 'audit']`) and audit narrowed to desktop, accessibility — opted
 * out, so never run, but resolving to the shared desktop + phone default —
 * put back a phone row the audit never measured. The opt-out path persists
 * skip markers at the file-level category viewports and
 * `persistedOutcomeInScope` keeps skip markers unconditionally, so the row
 * arrived non-empty and survived into report.json, where the phone-framed
 * client report rendered it as a "we couldn't measure this page" card.
 *
 * A category the test DOES declare still contributes all its viewports, so a
 * test that narrows visreg to desktop keeps its phone row when perf ran there.
 */
export function viewportsForTestAcrossStages(
  test: AbTestDefinition,
  stages: readonly Stage[],
  fileConfig: AbTestsConfig,
): Viewport[] {
  const labels = new Map<string, Viewport>();
  for (const stage of stages) {
    if (!testRunsForType(test, stage.category)) continue;
    for (const viewport of resolveViewportsForTest(test, fileConfig, stage.category)) {
      labels.set(viewport.label, viewport);
    }
  }
  return [...labels.values()];
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
