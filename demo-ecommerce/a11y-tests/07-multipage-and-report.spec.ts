/**
 * 07 — Multi-page audit + Playwright HTML report attachments
 * ==========================================================
 *
 * Real audits run against many routes. This file shows:
 *
 *   1. Using `test.describe.parallel` + parametrized tests to scan
 *      multiple routes independently (axe sessions don't share state).
 *   2. `testInfo.attach(name, { body, contentType })` to persist the full
 *      axe JSON and a screenshot onto the Playwright HTML report. Open
 *      the report with `yarn test:a11y:report` after the run; each test
 *      page has an "Attachments" section with clickable entries.
 *   3. `test.afterAll` to print a cross-route summary table so you can
 *      see at a glance which routes are worst.
 *
 * Why attachments matter: a11y reviews are shared across teams. CI
 * attachments ARE the deliverable — designers and PMs click through the
 * HTML report, they don't read terminal logs.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AxeResults } from 'axe-core';

// Every top-level route in the demo app. File 02 audits a single route;
// here we cover the whole surface.
const ROUTES = [
  { path: '/', label: 'home' },
  { path: '/products', label: 'product-list' },
  { path: '/products/1', label: 'product-detail' },
  { path: '/products/1/reviews', label: 'product-reviews' },
  { path: '/deals', label: 'deals' },
  { path: '/cart', label: 'cart' },
  { path: '/carousel-demo', label: 'carousel' },
] as const;

// Shared summary state: `test.afterAll` reads this after all routes finish.
// Safe because we run single-worker via fullyParallel but within one file
// the tests execute serially by default. (If you crank workers up, move
// this to a file-scoped fixture.)
const summary: Array<{ label: string; violations: number; topRules: string[] }> = [];

test.describe('07 - multi-page audit with report attachments', () => {
  for (const route of ROUTES) {
    test(`audit ${route.label} (${route.path})`, async ({ page }, testInfo) => {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const results: AxeResults = await new AxeBuilder({ page })
        // Real-world "AA across versions" target; matches file 02's final test.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      // ----- Attach full axe JSON ----------------------------------------
      // Downloadable from the HTML report. Pretty-printed so reviewers can
      // read it without tooling.
      await testInfo.attach(`${route.label}-axe-results.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      // ----- Attach screenshot ------------------------------------------
      // Gives reviewers the visual context for selectors listed in the
      // JSON. fullPage=true so lazy-loaded content below the fold is
      // included.
      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach(`${route.label}-screenshot.png`, {
        body: screenshot,
        contentType: 'image/png',
      });

      // ----- Attach a per-route text summary ----------------------------
      // Human-readable at-a-glance view. Reviewers often open this first.
      const summaryText = [
        `Route:       ${route.path}`,
        `Violations:  ${results.violations.length}`,
        `Passes:      ${results.passes.length}`,
        `Incomplete:  ${results.incomplete.length}`,
        `Inapplicable:${results.inapplicable.length}`,
        '',
        'Violations by rule:',
        ...results.violations.map(
          (v) => `  [${v.impact ?? '—'}] ${v.id} (${v.nodes.length} nodes) — ${v.help}`,
        ),
      ].join('\n');
      await testInfo.attach(`${route.label}-summary.txt`, {
        body: summaryText,
        contentType: 'text/plain',
      });

      // Feed the cross-route summary printed in `afterAll`.
      summary.push({
        label: route.label,
        violations: results.violations.length,
        topRules: results.violations
          .slice()
          .sort((a, b) => b.nodes.length - a.nodes.length)
          .slice(0, 3)
          .map((v) => `${v.id}(${v.nodes.length})`),
      });

      expect.soft(results.violations, `${route.label} has a11y violations`).toEqual([]);
    });
  }

  test.afterAll(() => {
    // Sorted worst-first so the noisiest routes land at the top.
    summary.sort((a, b) => b.violations - a.violations);
    console.log('\n===== Cross-route a11y summary =====');
    console.log('route'.padEnd(20), 'violations', 'top rules (rule(nodeCount))');
    for (const row of summary) {
      console.log(
        row.label.padEnd(20),
        String(row.violations).padEnd(10),
        row.topRules.join(', '),
      );
    }
    console.log('====================================');
  });
});
