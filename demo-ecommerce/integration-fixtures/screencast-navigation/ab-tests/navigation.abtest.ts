/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Screencast navigation continuity', { startingPath: '/' }, async ({ page, annotate }) => {
  const showMarker = async (label: string, color: string) => {
    await annotate(label);
    await page.evaluate(({ label, color }) => {
      const marker = document.createElement('button');
      marker.id = 'screencast-continuity-marker';
      marker.textContent = label;
      marker.style.cssText = `position:fixed;inset:0 0 auto;width:100%;height:120px;z-index:2147483647;background:${color};color:black;font:bold 24px sans-serif;border:0`;
      marker.onclick = () => {
        marker.textContent = `${label} AFTER CLICK`;
        marker.style.background = '#33ee66';
      };
      document.body.append(marker);
    }, { label, color });
    // Outlast the recorder's three-second retry window, then force a paint.
    // A static page alone cannot prove frames still arrive after the warning.
    await page.waitForTimeout(3_500);
    await page.locator('#screencast-continuity-marker').click();
    await page.waitForTimeout(600);
  };

  await waitUntilPageSettled(page);
  await showMarker('INITIAL', '#ffaa33');
  await page.goto('http://127.0.0.1:3067/products/1');
  await waitUntilPageSettled(page);
  await showMarker('SAME ORIGIN', '#33ccff');
  await page.goto('http://localhost:3068/');
  await waitUntilPageSettled(page);
  await showMarker('CROSS ORIGIN', '#ee66dd');
});
