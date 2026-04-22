# Axe Accessibility Testing — Requirements

**Status:** Draft
**Date:** 2026-04-23
**Scope:** Two-phase delivery. V1 adds a standalone `shaka-perf axe` command that runs WCAG accessibility checks on every ab-test against the experiment server. V2 starts immediately after V1 and integrates `axe` as a default category in `shaka-perf compare`, surfaced in the unified HTML report.

---

## 1. Goals

1. Run [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) against every `abTest()` defined in the project, producing a WCAG-violation list per test per viewport on the **experiment** server.
2. Ship quickly with a standalone `shaka-perf axe` command (V1), then immediately fold results into the same self-contained `compare-results/report.html` as visreg/perf (V2).
3. Fail CI (`process.exitCode = 1`) when any experiment test produces violations, unless globally disabled via `axe.failOnViolation: false`.
4. Let individual tests and the project globally tune which WCAG rules and viewports apply, without touching tool internals.

## 1.1 Delivery phases

1. **V1 (standalone first):** add `shaka-perf axe` command, per-test axe artifacts, and CI-friendly exit semantics.
2. **V2 (immediate next):** add `axe` to `shaka-perf compare` as a default category and render full a11y UX in report-shell.

## 2. Non-goals

1. **No control-vs-experiment diffing.** Axe scans the experiment server only. Whether the control had the same violations is not tracked, reported, or used to gate CI. (Rationale: this is a hygiene tool, not a regression detector — a violation is a violation regardless of what control shipped.)
2. **No fixes / auto-remediation.** Report surfaces violations + DOM node selectors + axe's help URL. Remediation is the developer's job.
3. **No integration with the twin-servers stack changes.** Axe consumes the same experiment URL twins already expose.
4. **No custom axe rules (v1).** Users configure the ruleset via WCAG tags and include/disable lists. Writing custom `axe.configure({ rules })` entries is out of scope.
5. **No per-selector scanning (v1).** `AxeBuilder.include(selector)` / `.exclude(selector)` is not exposed. Axe scans the whole document per viewport.

## 3. Functional requirements

### 3.0 Phase ownership

- Requirements marked **V1** must land in the standalone command release.
- Requirements marked **V2** land in the immediate follow-up release and are required before this feature is considered complete.

### 3.1 Category registration

- **V2:** `Category` type in `packages/shaka-perf/src/compare/report.ts` gains `'axe'` — the union becomes `'visreg' | 'perf' | 'axe'`.
- **V2:** `VALID_CATEGORIES` in `packages/shaka-perf/src/compare/cli/program.ts` includes `'axe'`.
- **V2:** `DEFAULT_CATEGORIES` in `packages/shaka-perf/src/compare/run.ts` is `['visreg', 'perf', 'axe']` — axe runs by default. Users opt out with `--categories visreg,perf`.

### 3.2 Status union

- **V2:** `Status` type gains `'a11y_violation'`.
- **V2:** `combineStatus` precedence (highest wins): `error` > `regression` > `visual_change` > `a11y_violation` > `improvement` > `no_difference`.
- Rationale for ranking below `visual_change`: a visual regression is a stronger "something changed" signal for this tool's A/B framing; a11y is a hygiene side-channel.

### 3.3 Global config

Added to `AbTestsConfigSchema` in `packages/shaka-perf/src/compare/config.ts`:

```ts
axe: {
  viewports: Viewport[];          // default: [mobile 375×667, desktop 1280×800]
  tags: string[];                 // default: ['wcag2a', 'wcag2aa']
  disableRules: string[];         // default: []
  includeRules?: string[];        // allowlist mode — if set, ONLY these rule IDs run
  engineOptions: EngineOptions;   // default: { browser: 'chromium', args: ['--no-sandbox'] }
  failOnViolation: boolean;       // default: true — controls CI exit code only
}
```

**Viewport default rationale:** mobile + desktop. No tablet (tablet a11y rarely differs from desktop and doubles scan time).

**`failOnViolation` escape hatch:** teams adopting the tool on a project with known legacy debt can set `false` to get the report without gating CI while they work through the backlog. Default `true` keeps the signal loud for clean projects.

Config model is required in **V1** (not deferred), and reused unchanged in V2.

### 3.4 Per-test override

Every `abTest()` gets an optional `options.axe` block:

```ts
abTest('Cart', {
  startingPath: '/cart',
  options: {
    visreg: { delay: 50 },
    axe: {
      tags: ['wcag2aa'],                 // narrow from global
      disableRules: ['color-contrast'],  // known marketing-approved exception
      skip: false,                        // or true to opt this test out entirely
    },
  },
}, async ({ page }) => { /* ... */ });
```

Supported per-test keys: `tags`, `disableRules`, `includeRules`, `viewports`, `skip`. No `engineOptions` or `failOnViolation` per-test (those are run-level concerns).

Per-test override support is required in **V1**.

### 3.5 Merge semantics (global ↔ per-test)

When a test carries `options.axe`, the effective config is computed per field:

| Field | Merge rule | Rationale |
|---|---|---|
| `tags` | **replace** if per-test present | Tag sets are semantic wholes (`wcag2a` vs `wcag21aa`); merging creates confusing supersets. |
| `disableRules` | **union** (concat + dedup) | "Globally disable these, plus for this test also disable X" is the common case. |
| `includeRules` | **replace** if per-test present | Allowlist mode is an explicit narrowing — inheriting a global allowlist then narrowing again is surprising. |
| `viewports` | **replace** if per-test present | Matches visreg's scenario override pattern. |
| `skip` | per-test only | No global skip (use `--filter` or remove `'axe'` from categories). |

The merged result is what the axe runner consumes for that test. Per-test values land in `AbTestDefinition.options.axe` via the existing registry — no changes to `shaka-shared` beyond widening the `options` type.

Merge semantics are required in **V1**.

### 3.6 Engine behavior

- One Playwright browser launched for the whole axe run (mirrors visreg).
- Per test × per viewport:
  1. `browser.newContext({ viewport: { width, height } })`
  2. `context.newPage()`
  3. `preparePage(page, experimentURL + test.startingPath, ...)` — **reuses `packages/shaka-perf/src/visreg/core/util/preparePage.ts`** so the user's `testFn` runs identically to the visreg path (cookies, ready events, click-and-hover helpers, annotations all included).
  4. `new AxeBuilder({ page }).withTags(tags).disableRules(disable).analyze()` — or `.withRules(include).analyze()` in allowlist mode.
  5. Close context.
- `axe.skip === true` bypasses steps 1-5 entirely for that test; harvest emits `{ status: 'no_difference', axe: { scans: [], totalViolations: 0, skipped: true } }` so the report can show a "skipped" pill.
- Concurrency: `axe.engineOptions` can carry an `asyncLimit` (default 2, matches visreg's `asyncCaptureLimit` default). Contexts run in parallel up to that cap.
- Results persisted to `<resultsRoot>/<slug>/axe-report.json` per test.

Notes by phase:
- **V1:** runner executes from `shaka-perf axe`, writes per-test `axe-report.json`, and reports CLI summary/exit code.
- **V2:** compare harvest consumes those artifacts for unified report output.

### 3.7 On-disk artifact shape

```json
{
  "testName": "Cart",
  "experimentURL": "http://localhost:3030/cart",
  "skipped": false,
  "effectiveConfig": { "tags": ["wcag2aa"], "disableRules": ["color-contrast"], "includeRules": null },
  "scans": [
    {
      "viewportLabel": "mobile",
      "violations": [
        {
          "ruleId": "aria-required-attr",
          "impact": "critical",
          "help": "Required ARIA attributes must be provided",
          "helpUrl": "https://dequeuniversity.com/rules/axe/4.x/aria-required-attr",
          "nodes": [
            { "target": ["#signup-form > input"], "html": "<input type=\"text\">", "failureSummary": "Fix any of the following: ..." }
          ]
        }
      ]
    }
  ]
}
```

`effectiveConfig` is persisted so a reader can tell exactly what ruleset produced the result without cross-referencing `abtests.config.ts` + the test file.

### 3.8 Harvest shape

`CategoryResult` gains:

```ts
axe?: {
  scans: Array<{
    viewportLabel: string;
    url: string;
    violations: AxeViolation[];
  }>;
  totalViolations: number;   // sum of violations[].length across scans
  skipped: boolean;
  effectiveConfig: { tags: string[]; disableRules: string[]; includeRules: string[] | null };
};
```

Status computed in harvest:
- `skipped === true` → `no_difference` (with a distinguishing flag on the artifact).
- `totalViolations > 0` → `a11y_violation`.
- otherwise → `no_difference`.

All harvest behavior in this section is **V2**.

### 3.9 CLI

- **V1:** add `shaka-perf axe` command.
  - Command supports: `--testPathPattern`, `--filter`, `--experimentURL`, `--config` (for loading `abtests.config.ts` defaults/overrides).
  - Exit code: `process.exitCode = 1` when `failOnViolation === true` (default) and any test's `totalViolations > 0`, or when execution errors occur.
- **V2:** no new compare-specific flags. `--categories` accepts `axe` and defaults include axe.
- **V2:** `--skip-engines` re-harvests `axe-report.json` files from a prior run, same as visreg/perf.
- **V2:** `summarizeFailures()` failure summary string includes `N a11y violation(s)` counter alongside regressions / visual changes / errors.

### 3.10 Report UI

New component `packages/shaka-perf/report-shell/src/components/AxeSlot.tsx`:

- One card per viewport, stacked vertically. Each card shows:
  - Header: viewport label + violation count (or "clean" / "skipped" pill).
  - Collapsible list of rules: `ruleId` · impact pill · N nodes.
  - Expanded rule: for each node, the `target[]` selector chain in a monospace block, first 200 chars of `html`, `failureSummary`, and a link to `helpUrl` (axe docs).
- `CategorySlot.tsx` switch extended: `result.category === 'axe' && result.axe ? <AxeSlot ... /> : null`.
- `StatusFilter.tsx` / `labels.ts`: `a11y_violation` gets a new token color (purple, distinct from visreg's crimson and perf's amber) and label "a11y violations".
- Test-card pill: when the test's axe category is `a11y_violation`, the pill reads `A11Y: <rule1>, <rule2>` using the same composition as perf's `REGRESSED: LCP, TBT` pattern.
- Engine-error surface: reuses the existing `CategoryResult.error` / `errorLog` slots — if axe crashes for a test, the error banner + per-slot error chip + log dialog work identically to visreg/perf without new code.
- Skipped behavior (resolved): when `options.axe.skip === true`, **hide** the a11y slot for that test.

All report UI behavior in this section is **V2**.

### 3.11 Failure modes (engine-level)

- Axe engine throws during `browser.launch()` → pushed into `ReportMeta.errors`, top banner renders it, every axe slot shows "axe engine aborted before this test".
- Axe engine throws on a single test (timeout, navigation failure) → wrap in try/catch per-test, write `<slug>/axe-engine-error.txt` + `<slug>/axe-engine-output.log`, harvest surfaces the error inline on just that test's axe slot. Other tests proceed.
- Matches the isolation model already in place for perf (see `packages/shaka-perf/src/bench/cli/commands/compare/index.ts`).

Failure isolation is required in **V1** and carried into V2 harvest/report.

### 3.12 Defaults applied when no config given

Running axe with no `axe:` block in `abtests.config.ts` and no `options.axe` on any test must:
- Scan every test on `[mobile, desktop]` viewports.
- Use `['wcag2a', 'wcag2aa']` tags.
- Exit non-zero if any violations found.

No silent opt-out paths.

## 4. Non-functional requirements

### 4.1 Performance

- Axe adds a third sequential engine pass after visreg and perf. Wall-clock overhead per test ≈ (viewports × scan time). Target: ≤ 5 seconds per test per viewport on the demo. Measured, not assumed.
- Parallelism: up to `asyncLimit` (default 2) browser contexts in parallel. Higher than visreg's default would destabilise shared CI runners; lower increases wall-clock.
- Memory: one axe analysis per open page. Close the context immediately after `analyze()` to free the memory before starting the next viewport.

### 4.2 Report size

- Axe violations can be verbose (`html` strings and `failureSummary` run long on real pages). Truncate each node's `html` to 500 chars and `failureSummary` to 2000 chars before embedding in the report JSON, preserving the original in the per-test JSON on disk. Keeps `report.html` under the 10-15 MB envelope we already hit with visreg PNGs.

### 4.3 Determinism

- Axe is deterministic per DOM snapshot, so run-to-run variance should come only from the user's `testFn` timing. `preparePage` already handles ready-event waits; no extra retries needed.

### 4.4 Dependency footprint

- Add `@axe-core/playwright` to `packages/shaka-perf/package.json`. `playwright` is already present. No other new runtime deps.

## 5. Out of scope (future)

1. Custom `axe.configure({ rules })` for project-specific rule tuning.
2. Per-selector `.include()` / `.exclude()` override in the test config.
3. Baseline suppression ("known violations file" to ignore until fixed) — the `failOnViolation: false` switch plus `disableRules` covers most adoption paths for now.
4. Trend reporting across runs.
5. Integration with the control server (if ever needed, a `compareToControl: true` flag could be added without schema churn).

## 6. Acceptance criteria

A PR shipping this is accepted when:

### V1 acceptance

1. `yarn shaka-perf axe` on `demo-ecommerce` runs axe on every test against `http://localhost:3030`, scanning mobile + desktop.
2. V1 writes per-test artifacts `<resultsRoot>/<slug>/axe-report.json` for executed tests.
3. Exit code is non-zero iff any test has ≥ 1 violation and `axe.failOnViolation !== false`.
4. Per-test override: adding `options: { axe: { disableRules: ['color-contrast'] } }` to one test in `demo-ecommerce/ab-tests/*.abtest.ts` causes exactly that test's run to exclude color-contrast violations while other tests still report them.
5. Global override: adding `axe: { tags: ['wcag2aa'] }` to `demo-ecommerce/abtests.config.ts` narrows every test to WCAG AA only, unless overridden per-test.
6. Axe engine crash on one test surfaces as a per-test error and does not stop other tests from running.

### V2 acceptance (immediate next release)

7. `yarn shaka-perf compare` runs axe by default (categories include `axe`).
8. `compare-results/report.html` shows an "a11y" slot for applicable tests. Violations are expandable. Clean tests show a "CLEAN" indicator.
9. `options.axe.skip === true` hides the a11y slot for that test.
10. `--categories visreg,perf` disables axe entirely (no Playwright launch, no `axe-report.json` files written for that run, report renders without a11y cards).
11. `yarn build` clean. `yarn workspace shaka-perf test` passes.

## 7. Open questions

1. **Node target selector format.** Axe can emit nested iframe-shadow-DOM selector arrays (`[["#parent", "#shadow"]]`). The report should render these as breadcrumbs. Confirm visual treatment.
2. **Command aliasing in V2.** After compare integration lands, should `shaka-perf axe` remain a first-class command, or become a thin wrapper around `shaka-perf compare --categories axe`?
