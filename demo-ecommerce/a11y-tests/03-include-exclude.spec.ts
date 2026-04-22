/**
 * 03 — Scoping the scan with .include() and .exclude()
 * ====================================================
 *
 * By default axe scans the whole document. For component-level audits or
 * to ignore a known-noisy region (third-party widget, legacy banner), you
 * can narrow scope:
 *
 *   .include(selector | selector[])  — ONLY scan matching elements.
 *                                      Call multiple times OR pass an array
 *                                      to include several regions.
 *   .exclude(selector | selector[])  — scan everything EXCEPT these.
 *
 * You can combine them: .include() sets the root, .exclude() carves holes.
 * Selectors can be any CSS selector. Nested form `[[root, innerRoot]]` is
 * also supported for shadow DOM piercing (not exercised here).
 *
 * Practical uses:
 *   - PR-sized audits: only scan the component you just changed.
 *   - "Baseline plus delta": exclude legacy sections, fix new ones first.
 *   - Isolating iframes or analytics widgets whose DOM you don't control.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('03 - .include() and .exclude() scoping', () => {
  test('include a single region (header only)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Only rules that match elements inside <header> will be evaluated.
    // Rules whose targets fall entirely outside this region land in
    // `inapplicable`, not `violations`.
    const results = await new AxeBuilder({ page }).include('header').analyze();

    console.log('\n[include=header]');
    console.log('  violations:  ', results.violations.length);
    console.log('  inapplicable:', results.inapplicable.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('include multiple regions via array (header + footer)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Array form scans each root independently and merges the results.
    const results = await new AxeBuilder({ page }).include(['header', 'footer']).analyze();

    console.log('\n[include=[header,footer]]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('exclude a noisy region (carousel) from a full-page scan', async ({ page }) => {
    await page.goto('/carousel-demo');
    await page.waitForLoadState('networkidle');

    // Pattern for when you KNOW a region is currently broken but want to
    // see what else is wrong. Use sparingly — it's a deferred-work marker.
    const results = await new AxeBuilder({ page })
      .exclude('[data-testid="carousel"]')
      .exclude('.slick-slider') // fallback: react-slick typically adds this class
      .analyze();

    console.log('\n[exclude carousel]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('include + exclude combined (scan main, skip aria-live announcers)', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    // Typical "component audit" shape: include the component's root,
    // exclude any descendant that's transient or out-of-scope.
    const results = await new AxeBuilder({ page })
      .include('main')
      .exclude('[aria-live]')
      .analyze();

    console.log('\n[include=main, exclude=[aria-live]]');
    console.log('  violations:', results.violations.length);
    // The `url` field is always the full page URL — scope doesn't change it.
    console.log('  url:       ', results.url);
    expect.soft(results.violations).toEqual([]);
  });

  test('chained include calls accumulate (same as array form)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Equivalent to .include(['header', 'main', 'footer']).
    const results = await new AxeBuilder({ page })
      .include('header')
      .include('main')
      .include('footer')
      .analyze();

    console.log('\n[chained include x3]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);
  });
});
