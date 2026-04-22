/**
 * 04 — Rule-level filtering: .withRules() and .disableRules()
 * ===========================================================
 *
 * When tags are too coarse, reach for rule IDs directly.
 *
 *   .withRules(ids | ids[])    — run ONLY these rules. Everything else is
 *                                skipped (not counted as inapplicable —
 *                                literally not evaluated).
 *   .disableRules(ids | ids[]) — run everything EXCEPT these. Useful to
 *                                silence a single noisy/flaky rule while
 *                                triaging the rest.
 *
 * `.withRules` and `.withTags` can be composed: tags narrow the universe,
 * rules narrow further. Don't try to pass BOTH .withTags and .withRules
 * for conflicting sets — .withRules wins and tags are ignored. But
 * `.withTags(...).disableRules(...)` composes cleanly: include by tag,
 * subtract specific rule IDs.
 *
 * Catalog of rule IDs (and what tags they carry):
 *   https://github.com/dequelabs/axe-core/blob/master/doc/rule-descriptions.md
 *
 * Common rules you'll see in real apps:
 *   color-contrast       — WCAG 1.4.3 (often noisy on gradients / MUI themes)
 *   image-alt            — WCAG 1.1.1
 *   label                — WCAG 1.3.1 / 3.3.2 (form inputs need a label)
 *   button-name          — WCAG 4.1.2 (accessible name on <button>)
 *   link-name            — WCAG 2.4.4 / 4.1.2 (accessible name on <a>)
 *   region               — best-practice (content must be in a landmark)
 *   landmark-one-main    — best-practice (exactly one <main>)
 *   heading-order        — best-practice (h1 → h2 → h3, no skipping)
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('04 - .withRules() and .disableRules()', () => {
  test('.withRules — targeted form/link/button audit on product detail', async ({ page }) => {
    await page.goto('/products/1');
    await page.waitForLoadState('networkidle');

    const ONLY = ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name'];

    const results = await new AxeBuilder({ page }).withRules(ONLY).analyze();

    console.log('\n[withRules] running only:', ONLY);
    // violations + passes + incomplete should only contain rule IDs from ONLY.
    const observed = new Set(
      [...results.violations, ...results.passes, ...results.incomplete].map((r) => r.id),
    );
    console.log('[withRules] observed rule IDs:', [...observed]);
    expect.soft(results.violations).toEqual([]);
  });

  test('.disableRules — silence known-noisy rules on a full scan', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Typical triage shape: "fix everything except these three while we
    // work on them separately." Keep a dated comment next to each entry
    // in real codebases so these don't become permanent.
    const SILENCED = ['color-contrast', 'region', 'landmark-one-main'];

    const results = await new AxeBuilder({ page }).disableRules(SILENCED).analyze();

    const seenInViolations = new Set(results.violations.map((v) => v.id));
    console.log('\n[disableRules] silenced:', SILENCED);
    console.log('[disableRules] still-failing rule IDs:', [...seenInViolations]);

    for (const id of SILENCED) {
      expect.soft(seenInViolations.has(id), `${id} should be suppressed`).toBe(false);
    }
    expect.soft(results.violations).toEqual([]);
  });

  test('composition — .withTags + .disableRules', async ({ page }) => {
    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    // Include WCAG 2.0 AA rules, but subtract color-contrast while the
    // design system team retunes the palette.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .analyze();

    console.log('\n[withTags + disableRules] on /deals');
    console.log('  violations:', results.violations.length);
    for (const v of results.violations) {
      console.log(`    [${v.impact}]`.padEnd(14), v.id, '—', v.help);
    }
    expect.soft(results.violations).toEqual([]);
  });
});
