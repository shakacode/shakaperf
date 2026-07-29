/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Re-export from shaka-shared — the ab-test registry now lives there
// so both bench and visreg domains can share it.
export {
  abTest,
  getRegisteredTests,
  clearRegistry,
  TestType,
} from 'shaka-shared';
export type {
  AbTestDefinition,
  AbTestConfig,
  TestFnContext,
} from 'shaka-shared';
