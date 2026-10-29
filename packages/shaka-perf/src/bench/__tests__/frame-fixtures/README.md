# Frame-matching fixtures

Real trace screenshots from two `shaka-perf compare` runs of the demo app,
after the timeline's exact-duplicate dedupe. They drive
`../frame-matching.test.ts`.

- `homepage-desktop/`, `homepage-phone/` — one directory per side plus
  `frames.json` with each frame's navigation-relative time in milliseconds.
  The JPEGs are re-encoded at 96px wide so a whole run costs tens of
  kilobytes; matching them was verified to give the same pairs as matching
  the native-resolution frames.
- `native/` — two frames at their original trace resolution (250x156 and
  140x248), so the signature is pinned against what the trace really emits.

Regenerate from a local compare run (its profiles are several MB and
gitignored, so they are not committed):

```bash
yarn node scripts/make-frame-matching-fixtures.mjs \
  ../../demo-ecommerce/compare-results/<test-dir>/artifacts <fixture-name>
```
