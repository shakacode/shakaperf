/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Page-settle helpers now live in shaka-shared. Re-export them here so user
// code that imports `'shaka-perf/visreg/helpers'` keeps working without
// changes. New code should prefer importing from `'shaka-shared'` directly.
export {
  waitUntilPageSettled,
  waitForAllImages,
  waitForNoMutations,
  waitForNetworkSettle,
  waitForFontsReady,
} from 'shaka-shared';
export type {
  WaitUntilPageSettledOptions,
  WaitForAllImagesOptions,
  WaitForNoMutationsOptions,
  WaitForNetworkSettleOptions,
  WaitForFontsReadyOptions,
} from 'shaka-shared';
export { interceptImages } from './interceptImages';
export { overrideCSS } from './overrideCSS';
