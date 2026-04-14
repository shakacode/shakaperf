---
name: perf-noise-summary
description: Read the per-run conclusion-*.txt files under packages/shaka-perf/src/bench/testData/ and write a single committed summary file with reliability counts per group. Use when the user asks to "summarize the noise-resilience results", "regenerate the regression summary", or similar.
---

# perf-noise-summary

Read the conclusions, summarize the results.

## Inputs

`packages/shaka-perf/src/bench/testData/<group>/conclusion-*.txt`

## Output

Overwrite `packages/shaka-perf/src/bench/testData/SUMMARY.md`.

## Procedure

1. For each group, `grep -h "hydration-start" testData/<group>/conclusion-*.txt`.
2. For each conclusion, classify the line:

   - `no difference` → no regression detected
   - `estimated regression +Xms` → regression detected
3. Write `SUMMARY.md`. **Pad every cell so the source lines up vertically** — compute each column's max width across header + rows and left-pad the `Group` column, right-pad the numeric columns. Header separator dashes must match each column's full width (use `-` for left-aligned, `-:` ending for right-aligned). Sort rows alphabetically by group name.

Example (note even column widths in the source, not just the rendered output):

```markdown
# Noise-Resilience Summary

| Group     | Runs | Regression detected | No difference |
| --------- | ---: | ------------------: | ------------: |
| <group-a> |  <N> |                 <D> |         <N-D> |
| <group-b> |  <N> |                 <D> |         <N-D> |
  ...
| <groupN>  |  <N> |                 <D> |         <N-D> |
```

4. Print a one-line confirmation with the file path. Do not commit.
