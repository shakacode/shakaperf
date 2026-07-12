# Git Bisect Seed History

This branch is intentionally shaped for future shaka-perf git bisect testing.
Commits alternate between harmless demo maintenance and deterministic regression
fixtures so category-specific bisect flows have clear first-bad targets.

The regression fixtures are artificial by design, but each one is scoped to the
demo app and kept easy to inspect.
