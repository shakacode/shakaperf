/**
 * 06 — Extending axe with .configure(): custom checks & rules
 * ===========================================================
 *
 * `.configure(spec)` lets you modify axe's rule engine BEFORE the scan runs.
 * This is how you:
 *
 *   - Add a custom check (a predicate evaluated against a DOM element).
 *   - Add a custom rule that wires one or more checks to a CSS selector.
 *   - Override metadata on an existing rule (e.g. bump `impact` from
 *     'moderate' to 'serious' to match your team's policy).
 *
 * Spec shape:
 *   {
 *     checks?: CheckSpec[]   // { id, evaluate: string (function source),
 *                            //   metadata: { impact, messages: {pass, fail} } }
 *     rules?:  RuleSpec[]    // { id, selector, any: [checkIds],
 *                            //   all: [checkIds], none: [checkIds],
 *                            //   enabled, metadata, tags }
 *   }
 *
 * IMPORTANT: `evaluate` is a STRING of JavaScript source, not a function.
 * axe-core serialises it into the page context with `new Function(...)`,
 * so it can't close over variables from your test file. Everything it
 * needs must come from its arguments (`node`, `options`, `virtualNode`,
 * `context`) or from globals already available in the page.
 *
 * Custom rules are registered in the axe runtime per test; they don't
 * persist. If you want repeat usage, factor the spec into a shared file.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('06 - .configure() custom rules & checks', () => {
  test('custom rule — flag <img> with empty src', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .configure({
        checks: [
          {
            id: 'check-img-src-not-empty',
            // Function source as a string. `node` is the matched Element.
            // Return true = check PASSES, false = check FAILS.
            evaluate: `function(node) {
              var src = node.getAttribute('src');
              return src !== null && src.trim() !== '';
            }`,
            metadata: {
              impact: 'serious',
              messages: {
                pass: 'Image has a non-empty src attribute',
                fail: 'Image has missing or empty src attribute',
                incomplete: 'Unable to determine image src',
              },
            },
          },
        ],
        rules: [
          {
            id: 'custom-img-src-not-empty',
            selector: 'img',
            // `any: [...]` means: at least one check must pass. With a
            // single check it's equivalent to `all: [...]` — but `any`
            // is the common default in axe's own rules.
            any: ['check-img-src-not-empty'],
            enabled: true,
            metadata: {
              description: 'Ensures <img> elements have a non-empty src attribute',
              help: 'Images must have a src attribute that is not empty',
              helpUrl: 'https://example.com/a11y/img-src-not-empty',
            },
            tags: ['custom', 'best-practice'],
          },
        ],
      })
      // `.withRules` restricts the run to our custom rule only. Without
      // this, axe would run its full default set PLUS our rule, which is
      // fine but makes the output harder to read.
      .withRules(['custom-img-src-not-empty'])
      .analyze();

    console.log('\n[custom rule: img src must be non-empty]');
    console.log('  violations:', results.violations.length);
    console.log('  passes:    ', results.passes.length);
    for (const v of results.violations) {
      console.log('  failed nodes:', v.nodes.map((n) => n.target));
    }
    expect.soft(results.violations).toEqual([]);
  });

  test('override an existing rule — bump heading-order impact to "critical"', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // `.configure` can also redeclare existing rules. You usually do this
    // to change metadata (impact, help text) while keeping axe's shipped
    // check logic. Below we reuse the built-in `heading-order` checks
    // by referencing them by id in `all`.
    const results = await new AxeBuilder({ page })
      .configure({
        rules: [
          {
            id: 'heading-order',
            // Re-declaring: `selector` and check wiring must match the
            // original. Here we reassert the default wiring and override
            // only the metadata.impact.
            selector: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
            any: [],
            all: [],
            none: ['heading-order'],
            enabled: true,
            metadata: {
              description: 'Heading levels should only increase by one',
              help: 'Heading levels should only increase by one (policy: critical)',
              helpUrl: 'https://dequeuniversity.com/rules/axe/heading-order',
              impact: 'critical',
            },
            tags: ['best-practice', 'custom-policy'],
          },
        ],
      })
      .withRules(['heading-order'])
      .analyze();

    console.log('\n[override: heading-order impact → critical]');
    for (const v of results.violations) {
      console.log(`  [${v.impact}]`.padEnd(14), v.id, '—', v.help);
    }
    expect.soft(results.violations).toEqual([]);
  });
});
