/**
 * 05 — Low-level axe options: .options() and .setLegacyMode()
 * ===========================================================
 *
 * Everything the high-level helpers (.withTags, .withRules, .disableRules)
 * do is expressible through `.options(runOptions)`, which passes straight
 * through to `axe.run()`. Reach for `.options()` when you need:
 *
 *   - `resultTypes`  : skip building unused result buckets (faster scans,
 *                      smaller JSON; violations-only runs are a common
 *                      CI choice).
 *   - `runOnly`      : low-level alternative to .withTags / .withRules.
 *                      Shape: { type: 'tag' | 'rule', values: string[] }
 *   - `rules`        : per-rule enable/disable with fine control —
 *                      { 'rule-id': { enabled: false } }
 *                      Same effect as .disableRules for that id, but also
 *                      lets you force-enable rules that are off by default.
 *   - `iframes`      : set false to skip recursing into iframes (faster on
 *                      pages with many third-party embeds).
 *   - `absolutePaths`: return absolute CSS selectors in node.target.
 *                      Useful when you consume results outside the page.
 *   - `elementRef`   : include the axe-internal element reference in
 *                      results — rarely needed in Playwright since node
 *                      targets are already selectors.
 *   - `reporter`     : which reporter axe uses internally ('v1' | 'v2' |
 *                      'raw' | 'no-passes'). Changes the shape of
 *                      nodes[].any/all/none.
 *
 * `.setLegacyMode(true)` switches iframe handling: axe injects itself into
 * top-level only, so cross-origin iframes are skipped entirely. Use it
 * when the modern mode (which hops frames) times out or errors on exotic
 * iframe setups. Modern mode is the default and what you want 99% of the
 * time.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('05 - .options() and .setLegacyMode()', () => {
  test('resultTypes — scan for violations only (skip passes/incomplete/inapplicable)', async ({
    page,
  }) => {
    await page.goto('/cart');
    await page.waitForLoadState('networkidle');

    // With `resultTypes: ['violations']`, axe still EVALUATES every rule,
    // but it populates only the violations bucket. passes / incomplete /
    // inapplicable contain a one-element summary (rule id only, no nodes).
    // This is a meaningful speedup on pages with many passing rules.
    const results = await new AxeBuilder({ page })
      .options({ resultTypes: ['violations'] })
      .analyze();

    console.log('\n[resultTypes=violations]');
    console.log('  violations.length:  ', results.violations.length);
    console.log('  passes.length:      ', results.passes.length, '(will be shallow)');
    console.log('  incomplete.length:  ', results.incomplete.length);
    console.log('  inapplicable.length:', results.inapplicable.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('runOnly — same as .withTags but via raw options', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Behaviourally identical to `.withTags(['wcag2a'])`. Shown here so
    // you recognise the shape when reading axe-core docs / source.
    const results = await new AxeBuilder({ page })
      .options({ runOnly: { type: 'tag', values: ['wcag2a'] } })
      .analyze();

    console.log('\n[options.runOnly type=tag values=[wcag2a]]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('rules — per-rule enable/disable map', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    // Equivalent to `.disableRules(['color-contrast'])` but shows the
    // underlying shape. You can also force-enable rules that axe ships
    // disabled by default (e.g. experimental ones) with `{ enabled: true }`.
    const results = await new AxeBuilder({ page })
      .options({
        rules: {
          'color-contrast': { enabled: false },
          region: { enabled: false },
        },
      })
      .analyze();

    const disabled = new Set(results.violations.map((v) => v.id));
    console.log('\n[options.rules disabled={color-contrast, region}]');
    console.log('  violations still reporting these rules?',
      disabled.has('color-contrast') || disabled.has('region'));
    expect.soft(disabled.has('color-contrast')).toBe(false);
    expect.soft(disabled.has('region')).toBe(false);
  });

  test('iframes=false — skip descending into iframes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Faster on pages with many third-party iframes (ads, analytics).
    // The home page likely has none — here just to show the option.
    const results = await new AxeBuilder({ page }).options({ iframes: false }).analyze();

    console.log('\n[options.iframes=false]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);
  });

  test('absolutePaths — full CSS paths in node.target', async ({ page }) => {
    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    // Default targets are selector paths starting from the nearest id/unique
    // ancestor. `absolutePaths: true` makes them fully-qualified from <html>.
    // Handy if you post-process results outside Playwright.
    const results = await new AxeBuilder({ page }).options({ absolutePaths: true }).analyze();

    if (results.violations.length > 0) {
      console.log('\n[options.absolutePaths=true]');
      console.log('  example target:', results.violations[0].nodes[0]?.target);
    } else {
      console.log('\n[options.absolutePaths=true] no violations to demo');
    }
    expect.soft(results.violations).toEqual([]);
  });

  test('setLegacyMode(true) — top-frame-only scanning', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Legacy mode: axe runs only in the top frame and ignores iframes
    // entirely. Modern default is to hop frames. Use legacy mode as an
    // escape hatch when modern mode fails on specific iframe setups.
    const results = await new AxeBuilder({ page }).setLegacyMode(true).analyze();

    console.log('\n[setLegacyMode(true)]');
    console.log('  violations:', results.violations.length);
    expect.soft(results.violations).toEqual([]);

    // Reset to modern behaviour for any subsequent chained call.
    // (Not strictly needed here since we don't reuse the builder, but
    // shown for completeness — pass false to restore modern mode.)
  });
});
