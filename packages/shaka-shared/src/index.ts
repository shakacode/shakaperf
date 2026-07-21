/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export {
  abTest,
  getRegisteredTests,
  clearRegistry,
  restoreRegistry,
  testRunsForType,
  TestType,
  PHONE_VIEWPORT,
  TABLET_VIEWPORT,
  DESKTOP_VIEWPORT,
  PHONE_TALL_VIEWPORT,
  TABLET_TALL_VIEWPORT,
  DESKTOP_TALL_VIEWPORT,
} from './ab-test-registry';
export type {
  AbTestDefinition,
  AbTestOptions,
  AbTestAccessibilityConfig,
  AbTestVisregConfig,
  TestFnContext,
  BeforeNavigateContext,
  BeforeNavigateHook,
  Marker,
  Viewport,
  FormFactor,
} from './ab-test-registry';
export { generateUnifiedDiff, escapeHtml, buildDiffHtml } from './html-diff';
export type { BuildDiffHtmlOptions } from './html-diff';
export { readTestSource } from './read-test-source';
export { embedAsBase64 } from './embed-asset';
export type { TestAnnotate } from './TestAnnotation';
export { defineConfig } from './define-config';
export { assignPortsAutomatically } from './assign-ports';
export type { AssignedPorts, AssignPortsOptions } from './assign-ports';
export type {
  AbTestsConfigInput,
  SharedConfigInput,
  VisregConfigInput,
  PerfConfigInput,
  AuditConfigInput,
  AccessibilityConfigInput,
  AccessibilityEngineOptionsInput,
  TwinServersConfigInput,
} from './define-config';
export { waitUntilPageSettled } from './page-helpers/waitUntilPageSettled';
export type { WaitUntilPageSettledOptions } from './page-helpers/waitUntilPageSettled';
export { waitForAllImages } from './page-helpers/waitForAllImages';
export type { WaitForAllImagesOptions } from './page-helpers/waitForAllImages';
export { waitForNoMutations } from './page-helpers/waitForNoMutations';
export type { WaitForNoMutationsOptions } from './page-helpers/waitForNoMutations';
export { waitForNetworkSettle } from './page-helpers/waitForNetworkSettle';
export type { WaitForNetworkSettleOptions } from './page-helpers/waitForNetworkSettle';
export { waitForFontsReady } from './page-helpers/waitForFontsReady';
export type { WaitForFontsReadyOptions } from './page-helpers/waitForFontsReady';
export { installRequestBlocking } from './page-helpers/installRequestBlocking';
