---
name: perf-noise-summary
description: Read the per-run conclusion-*.txt files under packages/shaka-perf/src/bench/testData/ and write a single committed summary file with reliability counts and mean p-value per group. Use when the user asks to "summarize the noise-resilience results", "regenerate the regression summary", or similar.
---

# perf-noise-summary

Read the conclusions, summarize the results.

## Inputs

`packages/shaka-perf/src/bench/testData/<group>/conclusion-*.txt`

## Output

Overwrite `packages/shaka-perf/src/bench/testData/SUMMARY.md`.

## Procedure

1. For each group, `grep -h "hydration-start" testData/<group>/conclusion-*.txt`.
2. For each conclusion line, classify:

   - `no difference` → no regression detected
   - `estimated regression +Xms` → regression detected. Extract the
     numeric p-value that follows ` p=` on the same line (e.g. the
     `0.007813` in `... p=0.007813`). "No difference" lines don't carry
     a p-value — skip them for the p-value calculation.
3. For each group, compute **mean p-value over the detected subset only**
   (arithmetic mean). Format as `%.2e` (e.g. `7.81e-03`) so column width
   stays sane across groups that span orders of magnitude. If the
   detected subset is empty (0 runs detected a regression), print `N/A`.
4. Write `SUMMARY.md`. **Pad every cell so the source lines up vertically** —
   compute each column's max width across header + rows and left-pad the
   `Group` column, right-pad the numeric columns. Header separator dashes
   must match each column's full width (use `-` for left-aligned, `-:`
   ending for right-aligned). Sort rows alphabetically by group name.

Example (note even column widths in the source, not just the rendered output):

```markdown
# Noise-Resilience Summary

| Group     | Runs | Regression detected | No difference | Mean p-value (detected) |
| --------- | ---: | ------------------: | ------------: | ----------------------: |
| <group-a> |  <N> |                 <D> |         <N-D> |                <x.yze-z> |
| <group-b> |  <N> |                 <D> |         <N-D> |                      N/A |
  ...
| <groupN>  |  <N> |                 <D> |         <N-D> |                <x.yze-z> |
```

5. Print a one-line confirmation with the file path. Do not commit.
