/**
 * 02 — Filtering by WCAG tags with .withTags()
 * ============================================
 *
 * axe-core rules are tagged with the standards they implement. Tagging lets
 * you decide WHICH STANDARD you're auditing against without hand-picking
 * rule IDs. `.withTags(tags)` restricts the run to rules that carry at
 * least one of the supplied tags (OR semantics across tags).
 *
 * Common tags:
 *   wcag2a        — WCAG 2.0 Level A
 *   wcag2aa       — WCAG 2.0 Level AA
 *   wcag2aaa      — WCAG 2.0 Level AAA (rarely a realistic target)
 *   wcag21a       — WCAG 2.1 Level A additions on top of 2.0
 *   wcag21aa      — WCAG 2.1 Level AA additions on top of 2.0
 *   wcag22aa      — WCAG 2.2 Level AA additions on top of 2.1
 *   best-practice — axe's opinionated rules NOT codified in WCAG
 *   ACT           — rules aligned with W3C ACT test cases
 *   section508    — US Section 508 rules (subset of WCAG 2.0 A)
 *   EN-301-549    — EU accessibility directive (superset of WCAG 2.1 AA)
 *
 * The real-world "AA across versions" choice is
 *   ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']
 * which is what most conformance claims actually mean.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTE = '/products';

// Helper: one line per violation so tag-set differences read like a diff.
function summarize(label: string, violations: Array<{ id: string; impact?: string | null }>) {
  console.log(`\n----- ${label} (${violations.length} violations) -----`);
  for (const v of violations) {
    console.log(`  [${v.impact ?? '—'}]`.padEnd(14), v.id);
  }
}

test.describe('02 - .withTags() WCAG level filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');
  });

  test('wcag2a — WCAG 2.0 Level A only', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a']).analyze();
    summarize('wcag2a', results.violations);
    expect.soft(results.violations, 'wcag2a violations on /products').toEqual([]);
  });

  test('wcag2aa — WCAG 2.0 Level AA only', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
    summarize('wcag2aa', results.violations);
    expect.soft(results.violations, 'wcag2aa violations on /products').toEqual([]);
  });

  test('wcag21aa — WCAG 2.1 AA additions on top of 2.0', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag21aa']).analyze();
    summarize('wcag21aa', results.violations);
    expect.soft(results.violations, 'wcag21aa violations on /products').toEqual([]);
  });

  test('wcag22aa — WCAG 2.2 AA additions on top of 2.1', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag22aa']).analyze();
    summarize('wcag22aa', results.violations);
    expect.soft(results.violations, 'wcag22aa violations on /products').toEqual([]);
  });

  test('best-practice — axe opinions not codified in WCAG', async ({ page }) => {
    // Expect this to be chattier: rules like `region`, `page-has-heading-one`,
    // and `landmark-one-main` live under `best-practice`, not WCAG.
    const results = await new AxeBuilder({ page }).withTags(['best-practice']).analyze();
    summarize('best-practice', results.violations);
    expect.soft(results.violations, 'best-practice violations on /products').toEqual([]);
  });

  test('combined AA across 2.0, 2.1, 2.2 — the common real-world target', async ({ page }) => {
    // This is what almost every "we're WCAG 2.2 AA compliant" claim maps to.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    summarize('combined AA', results.violations);
    expect.soft(results.violations, 'combined-AA violations on /products').toEqual([]);
  });
});
