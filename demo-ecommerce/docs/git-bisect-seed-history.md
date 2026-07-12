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
