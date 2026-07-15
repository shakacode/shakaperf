# Compare Bisect P-Values Design

## Goal

Display the saved performance p-value in bisect regression cards so threshold-edge findings can be evaluated directly from the report.

## Design

- Read `pValue` from each performance target's saved `badRefObservation.values`.
- Render performance targets as a six-column table: Metric, Control, Experiment, Delta, %Delta, and p.
- Format p-values with the same compact rules used by the existing performance metrics table.
- Leave visual and accessibility cards unchanged.
- Limit the desktop test-card grid to two columns and stack cards at narrower widths.
- Match the existing performance report's restrained spacing, dividers, and tabular number alignment.

## Verification

- Add a report-shell rendering test covering a normal p-value.
- Run the focused bisect app report test and package typecheck.
- Regenerate the existing report with `shaka-perf compare bisect --report-only`.
