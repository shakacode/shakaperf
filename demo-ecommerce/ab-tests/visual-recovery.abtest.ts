/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';

// Visual retries create fresh pages in the same browser. Keep the demonstration
// counter outside the page, but discard it when that browser is released.
const experimentCaptures = new WeakMap<object, number>();

abTest('Visual recovery demo - CSS mismatch then match', {
  startingPath: '/',
  testTypes: ['visreg'],
  visregSelectors: ['[data-cy="visual-recovery-swatch"]'],
  config: {
    shared: { retries: 0 },
    visreg: {
      viewports: ['desktop'],
      compareRetries: 1,
      compareRetryDelay: 100,
      mismatchThreshold: 0,
      maxNumDiffPixels: 0,
    },
  },
}, async ({ page, isControl, annotate }) => {
  const browser = page.context().browser();
  if (!browser) throw new Error('Visual recovery demo requires a browser-backed page.');

  let firstExperimentCapture = false;
  if (!isControl) {
    const captures = (experimentCaptures.get(browser) ?? 0) + 1;
    experimentCaptures.set(browser, captures);
    firstExperimentCapture = captures === 1;
  }

  // Compare only the synthetic swatch: unrelated application changes must not
  // prevent this intentional instability example from recovering.
  annotate(firstExperimentCapture ? 'Inject mismatching CSS' : 'Inject matching CSS');
  await page.evaluate(() => {
    const swatch = document.createElement('div');
    swatch.setAttribute('data-cy', 'visual-recovery-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    document.body.appendChild(swatch);
  });
  await page.addStyleTag({ content: `
    [data-cy="visual-recovery-swatch"] {
      all: initial !important;
      display: block !important;
      position: fixed !important;
      top: 16px !important;
      left: 16px !important;
      width: 240px !important;
      height: 120px !important;
      z-index: 2147483647 !important;
      background: ${firstExperimentCapture ? '#ef4444' : '#2563eb'} !important;
    }
  ` });
});
