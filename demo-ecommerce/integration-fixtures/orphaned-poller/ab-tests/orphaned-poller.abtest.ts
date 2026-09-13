/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';

// Shapes one sample so that, on unpatched Lighthouse, the load race is
// settled by the maxWaitForLoad branch while the critical-network-idle gate is
// still pending — the one gate Lighthouse forgets to cancel:
//
//   1. maxWaitForLoad (3s) expires while the page keeps one fetch in flight
//      (critical network never idle), so the timeout branch is the one parked
//      on the hold.
//   2. The testFn outlasts the cap, asks the page to stop fetching, and
//      returns; the hold releases and the timeout branch settles the race.
//   3. The last fetch drains, the critical gate resolves a moment later while
//      Lighthouse is still collecting artifacts, the load branch finally runs
//      and creates a cpu-idle poller nothing will cancel. CPU stays busy, so
//      the poller re-schedules itself past the page's teardown and its next
//      poll dies of "Protocol error (Page.enable): Session closed".
abTest('Orphaned CPU-idle poller', {
  startingPath: '/',
  testTypes: ['perf'],
}, async ({ page }) => {
  await page.waitForTimeout(3_500);
  await page.evaluate(() => (window as unknown as { __stopNetwork: () => void }).__stopNetwork());
});
