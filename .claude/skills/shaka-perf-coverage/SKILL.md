---
name: shaka-perf-coverage
description: Use when estimating Shaka Perf screenshot coverage from instrumented code coverage and audit visibility maps, comparing coverage with a saved baseline, or identifying duplicate A/B tests.
---

# shaka-perf-coverage

Estimate **screenshot coverage**: not "how many lines did the tests run", but "did the elements those lines render end up in a screenshot".

Two artifacts answer that, and both are written by the audit pipeline's `code_coverage` stage into `audit-results/<unit>/artifacts/`:

| Artifact | Question it answers |
| --- | --- |
| `coverage.json` | which test executed which source statement |
| `visibility-map.txt` | how much of each rendered element falls inside that test's `visregSelectors` |

Neither is enough alone. A line covered by test A whose element is `0%` visible in A's capture is a hole that no coverage percentage will ever show you.

## Before anything: make sure the data exists

Coverage is an opt-in CATEGORY of the audit pipeline — there is no config switch, and it is not in the default category set. Name it to run it:

```bash
shaka-perf audit --categories code_coverage --filter <relevant-tests>
```

Check what you actually got before drawing conclusions:

- No `visibility-map.txt` anywhere → the category did not run. Re-check the `--categories` value, and that the tests didn't opt out via `testTypes`.
- The `code_coverage` stage ERRORED with `window.__coverage__ is missing … the served bundle is not instrumented` → **STOP and tell the user.** The served bundle is not instrumented, so half the answer does not exist. Do not estimate around it, do not fall back to a visibility-only report, do not invent letters. Say exactly this much: the bundle carries no `window.__coverage__`, screenshot coverage cannot be estimated without it, and it is fixed by instrumenting the build — `babel-plugin-istanbul`, `nyc instrument`, or `swc-plugin-coverage-instrument` (see `demo-ecommerce/config/rspack/clientWebpackConfig.js` for a working rspack/SWC setup). Then wait for them.

  Why the hard stop rather than a partial answer: a visibility map alone says which elements are on screen, never which test's code put them there. An estimate built from it would attribute coverage nobody measured — the exact false confidence this skill exists to prevent.

`audit-results/report.json` names each unit id and, per `code_coverage` outcome, a `summary` carrying the statement counts and the artifact paths — start there rather than guessing directory names (they are not chronological).

## About code coverage

Shaka-perf is not your usual test framework. It's a performance framework, not a replacement for cypress/playwright, so it doesn't need to hunt edge cases.
When we say good ab-test coverage we don't mean `95% lines covered in the code base`. We mean `100% of important elements are screenshoted by ab tests`.
We don't care about `code coverage` — we use it as a signal to estimate `screenshot coverage`.

`view-coverage.js` (next to this file) prints each source with the tests that executed every line, keyed to a legend:

```
node <skill-dir>/view-coverage.js "<relevant-sources>"
```

`0` is a statement no test reached, `never loaded` means nothing fetched the chunk. Sources are discovered by walking `app/javascript`, so a regex that matches nothing says so instead of silently reporting good news.

`good coverage` is not a mechanically produced percentage. It is the absence of objective holes in the resulting screenshots, and you have to use your judgement.

KEEP IN MIND!!! THE SCRIPT OUTPUT ALONE IS NOT SCREENSHOT COVERAGE! IT IS CODE COVERAGE! SCREENSHOT COVERAGE REQUIRES THE MANUAL VISIBILITY PASS BELOW.

## Reading a visibility map

```
# test: Homepage
# viewport: phone
# url: http://localhost:3090/
# visregSelectors: document
# capture regions: 0,0,375,4210
# format: <indent by nesting> tag #id,.class => x,y,w,h N% visible (reason)
div #consumer-app => 0,0,375,4210 100% visible
  nav #navbar,.nav => 0,0,375,56 0% visible (obscured)
  section .carousel-track => 0,60,375,200 100% visible
    div .slide => 0,60,375,600 33% visible (clipped by ancestor)
  section .promo-drawer => 0,4210,375,300 0% visible (outside capture)
  p .ghost-cta => 0,900,375,40 0% visible (hidden by CSS)
  span .mobile-only-cta => 0,0,0,0 0% visible (not rendered)
```

- Boxes are document coordinates: `x,y,width,height`.
- The percentage is the share of that box a screenshot of this test would actually show, and the reason names the dominant cause when it is below 100%:

| reason | what happened | what to do about it |
| --- | --- | --- |
| `not rendered` | no box at all — `display:none`, never mounted, empty inline. Children are not walked, because none of them could be captured either. | the state the test leaves the page in never shows this element; drive the test to the state that does |
| `hidden by CSS` | `visibility:hidden`, `opacity:0`, or `content-visibility:hidden` | same — or it is a deliberate hide (a captcha, a transition end state) |
| `clipped by ancestor` | an ancestor's `overflow` crops it (carousel track, scroll box) | only the crop is coverage; scroll/advance the component in the test if the rest matters |
| `outside capture` | it falls outside this test's `visregSelectors` region | widen `visregSelectors`, or use a taller viewport if it is below the fold |
| `obscured` | something is painted on top: modal, sticky bar, cookie banner | dismiss the overlay in the test body, or accept that this test cannot cover it |

- Occlusion is SAMPLED (a 3x3 hit-test grid), so `obscured` percentages are approximate — treat them as "how much of this is behind something", not a precise area. It is also viewport-only: an element scrolled out of view is scored without an occlusion check, never penalised for one that could not run.
- `capture regions: (none …)` means the test's `visregSelectors` matched nothing — that test screenshots nothing at all. Fix the test before reading anything else.
- Percentages are per (test, viewport). One test usually has several maps.

## Create the estimated coverage

1. Choose a narrow comma-separated `relevant-sources` regex list. Reuse the exact same string for every audit and baseline comparison; changing it makes the diff meaningless.
2. Run `view-coverage.js "<relevant-sources>"` and keep its legend and gutters as the LEFT column.
3. Read each unit's `artifacts/visibility-map.txt` (paths from `report.json`). Match DOM elements back to the JSX/HTML in `relevant-sources` **by hand** — a script cannot know that `<ProductCard>` renders `article .product-card`. Anchor every match on something in the source: a `data-cy`/`data-testid`, an id, a class name, a tag+nesting shape.
4. Parallelize with subagents: one subagent per source file (or per small batch of tests). Give each only the source file, the legend, and the visibility maps it needs. Require each to return evidence rows — `source:line`, test letter, DOM selector, percentage, viewport — and nothing else. The primary agent, not the subagents, edits the estimate.
5. Append the RIGHT column. **Three columns on EVERY line**, both separators always present, even when a column is empty:

```text
<coverage gutter> │ <source line> │ <visibility>
```

```text
  A+B │   return (                                          │ A=100%,B=0%
      │     <nav className="site-nav" data-cy="main-nav">    │
    0 │       <button onClick={openCart}>Cart</button>       │
```

Pad the source column to a fixed width per file (the longest source line in it) so the third separator lines up in a straight edge. A line with no visibility evidence still ends in ` │` — that is what keeps the file a stable, column-addressable grid, so a later `git diff` shows a changed percentage as a one-character edit instead of re-wrapping the block.

Rules for the right column, in order of importance:

- Only letters already present in that line's LEFT gutter. A test that never executed the line cannot have rendered its element. A `0` or blank gutter gets an EMPTY third column, never a letter.
- When a test has several audited viewports, use its MAXIMUM percentage: coverage asks whether ANY screenshot shows the element, not whether all of them do.
- If you cannot find the element with evidence, write `A=?`. Never guess a number.

The annotated result is the `estimated-coverage`. Keep the legend and the `relevant-sources` header with it, so a later comparison uses identical test letters and scope.

## Coverage-based deduplication

Two tests that appear together on every line and never apart walked the same code — likely one rendered state under two names.

```
  A+B │     <Chip label={section.name} …
```

A signal, not a verdict: different states can share code paths, so diff the captures before acting. Prefer making the states differ over deleting. A test that is the only letter on some line carries unique coverage — leave it. The report's own `duplicate of` / `fully covered by` chips come from the same statement sets.

## Judging a change in coverage

`coverage-baseline.ts` snapshots `view-coverage.js` output. Save before your edits, then diff — it re-reads coverage now and compares, in the same gutter format.

```
node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"
node <skill-dir>/coverage-baseline.ts list
node <skill-dir>/coverage-baseline.ts diff "<relevant-sources>"                    # vs newest
node <skill-dir>/coverage-baseline.ts diff "<relevant-sources>" <snapshot-file>    # vs an older one
```

`save` never overwrites; every run adds a timestamped file under `coverage-baselines/`. `diff` regenerates coverage from the latest audit run and compares; it warns if the snapshot was saved with different sources. A letter turning into `0` is coverage lost on that line, `0` turning into a letter is coverage gained, and a letter leaving the legend means a test stopped touching these sources.

After `save`, perform the manual visibility pass on the snapshot and keep that annotated file as the estimated screenshot-coverage baseline. To compare later, run `diff` with the identical `relevant-sources`, build the current estimate under the same rules, and compare both columns. Report code-gutter changes and visibility changes SEPARATELY — a line that gained a letter but stayed `0%` visible gained nothing a screenshot can show.

## Common mistakes

- Producing any estimate at all when `coverage.json` is missing, instead of stopping and saying the bundle is uninstrumented.
- Expanding `relevant-sources` between the baseline and the current run.
- Treating a code-covered line as screenshot-covered without a visibility-map match.
- Adding a right-column test letter that is absent from the left gutter.
- Averaging viewports, which hides that one valid screenshot fully covers an element.
- Reading a stale `audit-results/<dir>` picked by name instead of the ids in `report.json`.
- Letting subagents edit the shared estimate instead of returning independently reviewable evidence.
