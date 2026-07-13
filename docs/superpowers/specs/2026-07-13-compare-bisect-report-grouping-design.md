# Compare Bisect Report Grouping Design

## Goal

Make the compare-bisect report emphasize actionable first-bad commits and make
selected regressions understandable by grouping them around their AB tests.

## Commit Navigator

The navigator separates clean history from regression-introducing commits.

- Every commit whose visual, performance, and accessibility counts are all
  zero belongs to one global clean-history box.
- The clean-history box shows the number of clean commits plus measured and
  unmeasured counts.
- The box uses an accessible disclosure so users can expand it to inspect each
  clean commit's short SHA, subject, endpoint label, and measurement status.
- Clean commits are not rendered as individual navigator cards.
- A commit is rendered as an individual card only when at least one category
  count is greater than zero.
- Regression commit cards remain in chronological order.
- Selecting a regression commit keeps the existing target filtering behavior.
- Clean commits do not become a new target selection because they have no
  associated first-bad regressions.

The navigator no longer represents every commit as one uninterrupted visual
chain. It presents a compact clean-history summary followed by the ordered set
of commits where regressions begin.

## Regression Summary

The selection summary groups selected targets by AB test rather than rendering
one card for every metric or accessibility rule.

Each test panel shows:

- the test name as its primary heading;
- the test file once as supporting identity;
- the number of selected regression targets;
- category sections for visual, performance, and accessibility regressions;
- one compact row per target with its subject and viewport; and
- readable control, experiment, and change values when those values exist.

Metric rows remain distinct across viewports. Accessibility rules remain
distinct across viewports. Visual selectors remain distinct across viewports.
Grouping changes presentation only; target IDs, commit filtering, category
filtering, and report-card focus behavior remain unchanged.

Raw observation properties are not dumped as unlabeled grids. The summary maps
known value pairs to human labels:

- `controlDisplay` or `controlValue` becomes `Control`;
- `experimentDisplay` or `experimentValue` becomes `Experiment`;
- `deltaDisplay`, `percentDisplay`, `deltaValue`, or `deltaPercent` becomes
  `Change`;
- accessibility violation/node counts become concise control-to-experiment
  comparisons; and
- remaining useful values appear under humanized labels only when they add
  information not already represented.

## Accessibility and Responsive Behavior

- The clean-history disclosure uses native `details` and `summary` semantics.
- Test panels use semantic headings, lists, and definition values.
- Selected-target status remains the single polite live region.
- The grouped layout collapses to one column on narrow screens.
- Long test files, subjects, and commit subjects wrap without forcing horizontal
  page overflow.
- The horizontal commit lane remains available only for regression commit
  cards when needed.

## Testing and Acceptance

Component and browser acceptance tests prove:

- all zero-count commits appear inside one clean-history box;
- zero-count commits no longer render individual commit cards;
- only positive-count commits render commit selection cards;
- the disclosure lists clean commit identity and measurement state;
- selected targets are grouped into one panel per test;
- targets from the same test and different categories/viewports appear inside
  that panel;
- commit selection still filters the grouped summary and actual report cards;
  and
- empty unresolved, invalid, and clean-commit states retain clear messages.

After implementation, rebuild the report shell and run
`shaka-perf compare bisect --report-only` against the current
`demo-ecommerce/compare-bisect-results` payload. Visually inspect the generated
HTML at desktop and narrow widths.
