/**
 * 01 — Anatomy of a scan result
 * =============================
 *
 * The simplest possible @axe-core/playwright usage: instantiate AxeBuilder,
 * call .analyze(), inspect the result. The goal of this file is to show you
 * the SHAPE of what axe returns, so every later file can focus on one
 * filtering/configuration feature without re-explaining the output.
 *
 * What you'll see printed:
 *   - Counts for the four result buckets: violations, passes, incomplete,
 *     inapplicable.
 *   - One fully expanded violation (every field axe gives you per rule).
 *   - Scan metadata: which axe engine version ran, which browser, when,
 *     against which URL, with what tool options.
 *
 * Key types (from `axe-core`):
 *   - AxeResults     — what .analyze() resolves to.
 *   - Result         — one rule's outcome. Appears in violations / passes /
 *                      incomplete / inapplicable.
 *   - NodeResult     — one matched DOM element under a rule, with selector,
 *                      outerHTML, impact, and a human-readable failureSummary.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('01 - Basic scan & result anatomy', () => {
  test('full-page scan on / with zero configuration', async ({ page }, testInfo) => {
    await page.goto('/');
    // Wait for hydration so we scan the React-rendered DOM, not the SSR shell.
    await page.waitForLoadState('networkidle');

    // The canonical AxeBuilder usage: pass the page, call analyze().
    // With no .withTags / .withRules / .include / .exclude, axe runs its
    // default rule set against the whole document.
    const results = await new AxeBuilder({ page }).analyze();

    // ----- Bucket counts --------------------------------------------------
    // `violations`   — rules that FAILED. This is usually what you act on.
    // `passes`       — rules that PASSED. Useful for "what's already ok".
    // `incomplete`   — rules axe couldn't determine. Manual review needed.
    //                   Common example: color contrast against gradient bg.
    // `inapplicable` — rules that had no matching elements on the page.
    console.log('\n----- Result buckets -----');
    console.log('violations:   ', results.violations.length);
    console.log('passes:       ', results.passes.length);
    console.log('incomplete:   ', results.incomplete.length);
    console.log('inapplicable: ', results.inapplicable.length);

    // ----- Metadata -------------------------------------------------------
    // Attached to every result; handy for audit trails and CI artifacts.
    console.log('\n----- Metadata -----');
    console.log('url:            ', results.url);
    console.log('timestamp:      ', results.timestamp);
    console.log('testEngine:     ', results.testEngine); // { name, version }
    console.log('testRunner:     ', results.testRunner); // { name }
    console.log('testEnvironment:', results.testEnvironment); // ua, viewport, etc.
    console.log('toolOptions:    ', JSON.stringify(results.toolOptions));

    // ----- One violation in full -----------------------------------------
    // Each `Result` has: id, impact, tags[], description, help, helpUrl,
    // nodes[]. Each `NodeResult` has: target[] (CSS selector path), html,
    // impact, failureSummary, any[]/all[]/none[] (which checks fired).
    if (results.violations.length > 0) {
      const v = results.violations[0];
      console.log('\n----- First violation, expanded -----');
      console.log('id:          ', v.id);
      console.log('impact:      ', v.impact); // minor | moderate | serious | critical
      console.log('tags:        ', v.tags); // e.g. ['cat.color', 'wcag2aa', 'wcag143']
      console.log('description: ', v.description);
      console.log('help:        ', v.help);
      console.log('helpUrl:     ', v.helpUrl); // link to axe-core docs with remediation
      console.log('nodes count: ', v.nodes.length);

      const n = v.nodes[0];
      console.log('\n  node[0].target:         ', n.target); // e.g. ['#root > main > button.x']
      console.log('  node[0].impact:         ', n.impact);
      console.log('  node[0].html (clipped): ', n.html.slice(0, 140));
      console.log('  node[0].failureSummary: ', n.failureSummary);
    } else {
      console.log('\n(no violations to expand — try a noisier page)');
    }

    // Report-first assertion: we want to SEE what's there, not fail fast.
    // Swap `expect.soft` → `expect` if you later want this as a CI gate.
    expect.soft(results.violations, 'axe found violations on /').toEqual([]);

    // Persist the raw JSON on the Playwright HTML report. Open with
    // `yarn test:a11y:report` after the run and click the test to see it.
    await testInfo.attach('axe-full-result.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  });
});
