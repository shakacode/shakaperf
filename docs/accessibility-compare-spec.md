# Accessibility in Compare

## Goal

Make accessibility a first-class `shaka-perf compare` category alongside visual regression and performance. Compare should run accessibility checks for the selected A/B tests, classify control-vs-experiment accessibility changes, and show those changes in the unified compare report.

This is a product and behavior spec. It intentionally avoids TypeScript implementation details.

## Current State

- `compare` currently runs `visreg`, `perf-warmup`, `perf`, and `perf-low-noise`.
- Accessibility already exists as an audit stage with global config, per-test accessibility overrides, artifacts, screenshots, and report UI pieces.
- `TestType` already includes `accessibility`, and explicit `testTypes` currently get `audit` and `accessibility` added automatically.
- Accessibility must use its own config surface. It must not read visreg-only options such as visual thresholds, cookie paths, image diff retry knobs, or screenshot selector behavior.

## Test And Viewport Selection

Accessibility should use the same selection model as the other compare categories:

- A test runs accessibility when `testTypes` is unset or includes `accessibility`.
- A test can opt out with `testTypes` or `options.accessibility.skip`.
- The executed viewports are the intersection of `shared.viewports`, `accessibility.viewports`, and `test.options.viewports`.
- If that intersection is empty, the report should show accessibility as skipped by viewport filtering, without making the whole test look failed.
- Per-test accessibility overrides apply only to that test and should not mutate global config or affect visreg/perf.

The current automatic addition of `accessibility` to explicit `testTypes` should be revisited. For compare, first-class category behavior is easier to reason about if `testTypes: ['visreg']` means only visual work, while omitted `testTypes` means all default categories.

## Pipeline Behavior

Add an accessibility compare stage to the compare pipeline. It should be independent of visreg and perf outcomes:

- A visual failure should not prevent accessibility from running.
- An accessibility violation should not prevent perf or low-noise perf from running.
- A navigation or engine error in accessibility should produce an accessibility error outcome for that test/viewport, not a misleading "no difference" result.
- Shared runner failures can still fail the whole run when the runner cannot continue.

Accessibility navigation should mirror the perf lifecycle: clear browser state, run global and per-test `beforeNavigate`, optionally reload cookie state, then navigate. Visreg behavior should only be reused when it does not conflict with that lifecycle.

## A/B Comparison Model

For each test and viewport, accessibility should scan both control and experiment and compare findings by stable violation signature:

- Rule identity: axe rule id.
- Location identity: normalized target path, and enough node/html context to distinguish separate instances without being too fragile.
- Metadata: impact, help text, tags, node count, and relevant failure summary.

Classify findings as:

- New violation: present in experiment, absent in control.
- Fixed violation: present in control, absent in experiment.
- Unchanged violation: present in both.
- Changed violation: same rule/location exists on both sides, but impact or node count changed meaningfully.
- Error: scan could not complete for one or both sides.

Impact grouping should use axe impact levels: critical, serious, moderate, minor, and unknown. New critical/serious violations are the highest-priority failures. Fixed violations are positive changes. Unchanged violations are useful context but should be quiet by default.

## Report Cards And Chips

Each test card should summarize accessibility without overwhelming visreg/perf signals:

- `accessibility regression`: red chip for new violations, weighted ahead of visual changes and perf improvements.
- `accessibility fixed`: green or blue chip for fixed violations.
- `accessibility changed`: yellow chip when existing findings changed in count or impact.
- `accessibility unchanged`: gray chip, hidden by default.
- `accessibility error`: red chip when the scan failed or produced incomplete comparison data.

Chip text should include concise counts, for example `a11y: 2 new, 1 fixed`. Tooltips can break counts down by impact.

The "no difference" chip should only appear when every category that actually ran found no meaningful difference. Do not show "no accessibility issues" or similar text when accessibility was skipped.

## Report UI

Add an Accessibility section to each compare test card when accessibility ran or was skipped/erroring. The section should include:

- A compact summary row with new, fixed, changed, unchanged, and error counts.
- Viewport grouping.
- Controls to filter by status, impact, rule id, tag, and viewport.
- A collapse/hide control so users can temporarily hide bulky accessibility sections while reviewing other categories.
- A details dialog for each finding with control and experiment URLs, rule help, impact, tags, affected targets, failure summary, and screenshots when available.
- Side-by-side context for control vs experiment, especially for new and fixed findings.
- Links to raw artifacts for deeper debugging.

The existing audit accessibility screenshot preview and filtering concepts should be reused where they fit, but the compare UI needs A/B-oriented language: new, fixed, unchanged, changed.

## Filtering And Sorting

The unified compare report should let users filter by accessibility chips the same way they filter visual/perf chips. Accessibility-specific filters should support:

- New violations only.
- Fixed violations only.
- Critical/serious only.
- A specific axe rule id or tag.
- Accessibility errors.
- Unchanged findings, hidden by default.

Sort dimensions should include:

- New critical/serious violations first.
- Total new violations.
- Accessibility errors.
- Fixed violations, when the user wants to review improvements.

Accessibility sorting should compose with existing visual and perf sorting rather than replacing it.

## Artifacts

Artifacts should live under the existing per-test/per-viewport compare artifact directory. For each side and viewport, store:

- Raw accessibility scan JSON.
- A normalized comparison JSON used by the report.
- Screenshots, with node metadata sufficient for highlighting or linking.
- Error screenshots when navigation or scanning fails.

The report should link to raw and normalized artifacts. Lightweight reports should avoid embedding large raw payloads when links are enough; full reports can include richer screenshot data.

## Config Surface

Use the existing accessibility config as the base:

- `accessibility.viewports`
- `accessibility.tags`
- `accessibility.disableRules`
- `accessibility.includeRules`
- `accessibility.engineOptions`
- `accessibility.failOnViolation`
- per-test `options.accessibility`

Add only compare-specific config if it solves a product need that global accessibility config cannot express. Likely candidates:

- Whether unchanged findings are shown by default.
- Whether only new violations fail CI.
- An allow-list/baseline model for known violations.

Do not inherit from `visreg` config. Shared config such as URLs, viewports, parallelism, timeout, retries, and `beforeNavigate` can remain shared runner behavior.

## Backwards Compatibility

Existing compare users should get a predictable migration path:

- If omitted `testTypes` means "run all compare categories", adding accessibility may increase runtime and CI failures. Release notes should call this out.
- If explicit `testTypes` currently auto-adds accessibility, decide whether to keep that behavior temporarily or migrate to literal category selection.
- Existing visreg/perf report behavior and chips should not change except where the combined "no difference" state needs to account for accessibility.
- Existing audit accessibility behavior should continue to work independently of compare.

## Acceptance Criteria

- `shaka-perf compare` can run accessibility for selected tests and viewports.
- Tests can include, exclude, or skip accessibility predictably.
- Accessibility scans run against both control and experiment.
- The report correctly classifies new, fixed, unchanged, changed, and error findings.
- New accessibility violations can fail CI according to config.
- Existing visual and perf results still render and sort correctly.
- Accessibility sections include useful filters, details dialogs, screenshots, and raw artifact links.
- Skipped accessibility does not produce misleading "clean" messaging.
- Accessibility uses perf-style navigation setup and does not depend on visreg-only options.
- Existing audit accessibility reports still behave as before.
