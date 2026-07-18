# Project follow-ups

## Consolidate site-fetch SSRF validation

The favicon and AI-readiness fetch paths currently maintain separate public-host allow-list logic. Design a shared helper that preserves the AI-readiness fetch semantics before migrating both callers so their security behavior stays aligned.

## Centralize HTML escaping

Warm-email rendering paths repeat the same security-sensitive HTML escaping behavior. Evaluate the existing `escapeHtml` helper in `packages/shaka-shared/src/html-diff.ts`, separate it from diff-specific dependencies if necessary, and migrate callers without coupling site-asset fetching to report-model code.
