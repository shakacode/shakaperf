# Git Bisect Seed History

This branch is intentionally shaped for future shaka-perf git bisect testing.
Commits alternate between harmless demo maintenance and deterministic regression
fixtures so category-specific bisect flows have clear first-bad targets.

The regression fixtures are artificial by design, but each one is scoped to the
demo app and kept easy to inspect.

Clean commits in this branch should stay runtime-neutral. They can update this
note or other demo-only documentation without changing measured pages.

Runtime fixtures should prefer existing measured routes so future bisect tests
do not need a special-case demo configuration.

The homepage fixtures are intended for the existing homepage and shop-now
coverage. The product detail fixture is intended for the existing product detail
coverage.

Performance fixtures should use deterministic client-side work instead of
network delays so results remain easy to reproduce in local containers.

Accessibility fixtures should avoid layout-visible changes when they are meant
to be accessibility-only.

Clean commits should be safe to classify as good for every category that has
not yet received its first dedicated regression fixture.

Combined regression commits are useful for checking that category-specific
bisect still reports the earliest bad commit for each individual category.

Product detail fixtures should avoid changing product data or cart behavior, so
they remain independent of Rails seeds and API responses.

Fixture commits should stay small enough that `git show` explains the category
signal without requiring a full app run.

Seed base: `38dae68` (`main` when this branch was created).

Category map:

- `623a1ae` - no regression, seed docs only.
- `fe8900e` - no regression, docs only.
- `58cc828` - first `visreg` bad commit, homepage hero color change.
- `a55e7f4` - no regression, docs only.
- `754fcd9` - no regression, docs only.
- `9c7cfff` - first `perf` bad commit, homepage CPU warmup.
- `744fe90` - no regression, docs only.
- `ac38e53` - no regression, docs only.
- `463c429` - no regression, docs only.
- `fcb0e2b` - first `accessibility` bad commit, offscreen unnamed button.
- `c1e2a62` - no regression, docs only.
- `ce1f601` - no regression, docs only.
- `3846371` - no regression, docs only.
- `5345dff` - visual plus performance regression on product detail.
- `088afb9` - no regression, docs only.
- `4406a78` - no regression, fixture-impact docs only.

Expected affected AB tests and metrics:

- `Homepage` / `visreg` - screenshot mismatch and diff pixels for
  `[data-cy="hero-section"]` and `document` after the hero gradient changes.
- `Homepage` / `perf` - primarily worse `TBT` and lower `LH Score` from the
  450ms homepage CPU warmup. `speed-index`, `FCP`, and `LCP` can also move
  depending on timing.
- `Homepage` / `accessibility` - a new axe finding, expected to be
  `button-name`, from `button[data-cy="bisect-a11y-probe"]`.
- `Click Shop Now on the homepage` / `perf` - primarily worse `TBT` and lower
  `LH Score` in the phone viewport because the test starts on `/` and runs the
  homepage CPU warmup.
- `Product Detail` / `visreg` - screenshot mismatch and diff pixels from the
  product image `boxShadow`.
- `Product Detail` / `perf` - primarily worse `TBT` and lower `LH Score` from
  the 350ms product-detail CPU warmup.
- `Product Detail - Show Product Journey Toggle` / `visreg` - likely full-page
  screenshot mismatch from the product image `boxShadow` in the phone viewport.

Expected unaffected AB tests:

- `Product Detail - Desktop Actions` captures only
  `[data-cy="product-actions-desktop"]`, so the product image `boxShadow` should
  not appear in its screenshot.
- `Click Reviews on Product Detail` and
  `Product Details => Click on Reviews => Click on Deals` end on reviews or
  deals pages and run as visual-only tests, so the product-detail image change
  should not be captured.
- `Products List`, `Cart`, `Carousel`, and `Admin` do not visit touched routes
  or changed fixtures.
- Product-detail accessibility should stay unchanged because no semantic
  accessibility regression was added there.
