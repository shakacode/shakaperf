# Compare Bisect P-Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display saved performance p-values in compare bisect regression cards.

**Architecture:** Render performance targets through a dedicated table with aligned metric, control, experiment, delta, percent, and p-value columns. Reuse the existing performance report formatting rules, keep non-performance targets unchanged, and cap the test-card grid at two columns.

**Tech Stack:** TypeScript, React 19, Jest, React DOM server rendering, Vite.

## Global Constraints

- Read only persisted `badRefObservation.values.pValue` data.
- Keep visual and accessibility cards unchanged.
- Regenerate the existing report only through `shaka-perf compare bisect --report-only`.

---

### Task 1: Render Bisect P-Values

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`
- Modify: `packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx`

**Interfaces:**
- Consumes: `BisectReportTarget.badRefObservation.values.pValue`
- Produces: A six-column performance target table inside each bisect test card.

- [ ] **Step 1: Write the failing rendering test**

Add `pValue: 0.007813` to the homepage performance fixture and assert that its group markup contains the six table headings and a `0.007813` value cell.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `yarn workspace shaka-perf test --runInBand packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`

Expected: FAIL because the bisect card does not render the performance table.

- [ ] **Step 3: Implement minimal p-value rendering**

Add a dedicated performance comparison model, format finite numeric values using the same six-decimal, trimmed, exponential-under-1e-6 rules as the performance report, and render one semantic table row per performance target. Update the card grid and table spacing in `styles.css`.

- [ ] **Step 4: Run focused verification**

Run: `yarn workspace shaka-perf test --runInBand packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`

Expected: PASS.

Run: `yarn workspace shaka-perf typecheck`

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx docs/superpowers/plans/2026-07-15-compare-bisect-p-values.md
git commit -m "feat(compare): show p-values in bisect report"
```

### Task 2: Regenerate Saved Report

**Files:**
- Regenerate: `demo-ecommerce/compare-bisect-results/bisect-report.html`

**Interfaces:**
- Consumes: Existing `demo-ecommerce/compare-bisect-results` session and report data.
- Produces: Updated self-contained bisect HTML report.

- [ ] **Step 1: Build the report shell**

Run: `yarn workspace shaka-perf build-report-shell`

Expected: PASS and refreshed inlined report-shell assets.

- [ ] **Step 2: Regenerate without running comparisons**

Run from `demo-ecommerce`: `shaka-perf compare bisect --report-only`

Expected: PASS and rewrite `compare-bisect-results/bisect-report.html` without deleting commit artifacts.

- [ ] **Step 3: Verify generated p-values**

Confirm the generated HTML contains the `p` label and the saved `0.007813` value.
