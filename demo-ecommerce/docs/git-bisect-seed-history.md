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

- `f2cd5c9` - no regression, seed docs only.
- `267da30` - no regression, docs only.
- `aa1b86a` - first `visreg` bad commit, homepage hero color change.
- `c9b2c71` - no regression, docs only.
- `a24c926` - no regression, docs only.
- `5d38dcf` - first `perf` bad commit, homepage CPU warmup.
- `4dbb382` - no regression, docs only.
- `af79caf` - no regression, docs only.
- `c0adc35` - no regression, docs only.
- `38e7882` - first `accessibility` bad commit, offscreen unnamed button.
- `5956eb6` - no regression, docs only.
- `db65ccd` - no regression, docs only.
- `5c3dbad` - no regression, docs only.
- `993637a` - visual plus performance regression on product detail.
