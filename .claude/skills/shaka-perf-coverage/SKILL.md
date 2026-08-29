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

`view-coverage.js` (next to this file) prints each source with its coverage appended as a trailing comment, keyed to a legend:

```
node <skill-dir>/view-coverage.js "<relevant-sources>"
```

Sources are discovered by walking `app/javascript`, so a regex that matches nothing says so instead of silently reporting good news. Normally you do not call this directly — `coverage-baseline.ts save` runs it to write a snapshot directory.

`good coverage` is not a mechanically produced percentage. It is the absence of objective holes in the resulting screenshots, and you have to use your judgement.

KEEP IN MIND!!! THE SCRIPT OUTPUT ALONE IS NOT SCREENSHOT COVERAGE! IT IS CODE COVERAGE! SCREENSHOT COVERAGE REQUIRES THE MANUAL VISIBILITY PASS BELOW.

That distinction is not pedantry, it is the usual result. In one real run `OrderButton` sat at 15/16 statements and `MenuCardReviewQuote` at 9/12 — both flag-gated, both painting **nothing** in any of 65 screenshots. Read as code coverage those two files look almost done; read as screenshot coverage they are empty.

## Reading a visibility map

```
# test: Homepage
# viewport: phone
# url: http://localhost:3090/
# visregSelectors: document
# capture regions: 0,0,375,4210
# format: <indent by nesting> tag [data-testid="x"],[role="tab"],#id,.class => x,y,w,h N% visible (reason)
div #consumer-app => 0,0,375,4210 100% visible
  nav [data-testid="main-nav"],#navbar,.nav => 0,0,375,56 0% visible (obscured)
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

## The snapshot loop

**save + annotate the before → make your change → re-audit → save + annotate the after → diff the two.**

```
node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"
node <skill-dir>/coverage-baseline.ts list
node <skill-dir>/coverage-baseline.ts diff                          # the last two snapshots
node <skill-dir>/coverage-baseline.ts diff <older-dir> <newer-dir>
```

1. Choose a narrow comma-separated `relevant-sources` regex list. Reuse the exact same string for every save; changing it makes the diff meaningless.
2. `save` writes a timestamped SCAFFOLD **directory** under `coverage-baselines/` — one file per source, mirroring its path under `app/javascript`, plus `legend.txt`. It never overwrites. **A scaffold is not a baseline**: the screenshot field is empty until step 5, and you type into the saved files IN PLACE, never into chat or a scratch file, because `diff` reads the directory and nothing else.

### The format

Each line is the source line, then its coverage as a trailing comment:

```text
<source line>  // <tests that executed it> | <what a screenshot showed>
```

```text
  return (                                          // A+B   | A=100%,B=0%
    <nav className="site-nav" data-cy="main-nav">   //       |
      <button onClick={openCart}>Cart</button>      // 0     |
```

Three properties, each there to keep a diff honest:

- **Source first.** The left of `//` is byte-identical between two runs of the same commit, so nothing a measurement does can push a source line sideways.
- **Metadata last, coverage field padded to the widest gutter in the RUN** (not per file, recorded in `legend.txt`). The `|` lands in the same column in every file, and a line gaining a test letter cannot re-indent its neighbours. The column only moves when the set of tests changes — which is a real event you want to see.
- **One file per source.** An unrelated component's change stays out of the diff entirely, and `diff -ru` reports per file.

`0` is a statement no test reached, blank means no statement starts on that line, `never loaded` means nothing fetched the chunk.

### Populating screenshot coverage

You supply the anchors; the helper does the lookup. Write `<snapshot-dir>/anchors.json`:

```json
{
  "consumer/menus/FeaturedMenuItemCard/FeaturedMenuItemCard.jsx": { "123": "\\.featured-item-dish-card" },
  "consumer/menus/HorizonNav/HorizonNav.tsx": { "59": "\\[data-tour-id=\"menu-nav-section-select-button\"\\]" },
  "consumer/menus/CompactMenuSection/CompactMenuSection.tsx": { "84": "?" }
}
```

source path → **source line of the element** → regex matched against a map row's `tag [data-*],#id,.class`. Then `coverage-baseline.ts fill <dir>`.

Anchoring is the judgement and it is yours; the rest is transcription across tens of thousands of map lines, which is where hand-typing invents numbers. Choose a hook a human wrote and a rebuild preserves — `data-testid`/`data-test-id`/`data-cy`/`data-qa`/`data-tour-id`, or `role`/`aria-label`/`aria-current`/`aria-selected`, or an `#id`, or a project class like `.pm-*`. **Never a CSS-in-JS class** (`.jss159`, `.css-1a2b3c`): it is regenerated every build. When a component carries no stable hook at all, write `"?"` — that is a finding about the component, not a number to invent.

**Only rendered statements are looked up.** The helper attaches an anchor to the nearest covered statement *inside a function body*, skipping top-level ones. A module-level line is covered the moment its chunk is fetched, so anchoring there yields a letter for every test that merely imported the component — and a `?` for each, since nothing was drawn. Those cells are noise, and they crowd out the real ones. If an anchor reports as unattached, its element is rendered by no covered statement, which is itself the answer.

`save` carries `anchors.json` forward from the previous snapshot, so anchoring is paid for once and every later run is a re-grep.

Rules the helper applies, worth knowing when reading its output:

- Only letters already in that line's coverage field. A test that never executed the line cannot have rendered its element.
- The MAXIMUM across a test's viewports: coverage asks whether ANY screenshot shows the element, not whether all do.
- Absence means two different things. Anchor matches in some tests but not this one → **`0%`**, a measurement: those screenshots showed none of it. Anchor matches nothing anywhere → **`?`**, and the helper lists it for you to re-check, because a regex that never resolves is likelier wrong than an element nothing renders.

3. Parallelize with subagents: one per source file, or per small batch of tests. Give each only the source file, the legend, and the anchors it needs. Require each to return evidence rows — `source:line`, test letter, DOM selector, percentage, viewport — and nothing else. The primary agent, not the subagents, edits the snapshot.
4. **Keep the anchors.** The `source:line → selector` mapping is the expensive part and the only part that carries judgement; the percentages are re-derivable from any run. Save it next to the snapshot so the next run is a re-grep instead of a re-think.
5. The annotated snapshot is the `estimated-coverage`, and it is the only artifact that carries screenshot coverage — the coverage field alone is code coverage. Before calling one done, check that every source with a rendered element has percentages; `list` prints `scaffold only` for a snapshot you never finished.
6. `diff` compares two saved snapshots and writes `<newer>--vs--<older>.diff/`:

- **`summary.txt`** — covered statements per source, before → after → delta, plus the screenshot-cell count. Read this first; it is usually the whole verdict.
- **one `.diff` per source, and ONLY for sources that changed.** The listing is therefore the index: `ls` names the components that moved, and `wc -l` ranks them by how much. Unchanged sources are marked `(no diff)` in the summary and write no file — an empty file for every unchanged source would destroy exactly that property.

**Lead every report with the screenshot numbers.** `seen → seen` is the answer to the question this skill asks; `covered → covered` is a supporting signal that a test executed the code. They routinely disagree, and when they do the screenshot column is the truthful one — a source can sit at 100% statement coverage and still put nothing on screen. Quoting the statement delta as the headline is how a run gets reported as a win when no picture changed.

Read both, because the two kinds of regression do not travel together:

- a coverage letter turning into `0` is code coverage lost on that line; `0` turning into a letter is coverage gained
- a letter leaving the legend means a test stopped touching these sources
- a percentage falling to `0%` is a screenshot that stopped showing the element even though the coverage field never moved — usually a layout change pushing it out of the capture
- a line that gained a letter but stayed `0%` gained nothing a screenshot can show
- a source with high statement coverage and `0 seen` is the signature this skill exists to catch: the component runs and paints nothing. Chase the gate — a rollout flag, missing data, an early `return null` — before believing the coverage number

Nothing regenerates a side from the current audit run: a fresh scaffold has an empty screenshot field, and comparing against one would report every percentage you typed as a deletion. `diff` warns when either side is still a bare scaffold, or when the two were saved with different `relevant-sources`.

Beware a large `.diff` that says nothing: a MODULE-LEVEL statement gains letters when its chunk is fetched, not when the component renders. A file whose only changes are outside a function body moved no pixels — check whether the in-body lines moved before reporting it as coverage.

Two runs measured against DIFFERENT SERVERS can disagree on which line a statement starts — two builds instrument independently. When whole files show as rewritten, compare per-file counts rather than per line before concluding anything.

To snapshot a run whose `audit-results/` has since been overwritten, keep the directory and point at it: `AUDIT_ROOT=<stashed-dir> node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"`.

## Coverage-based deduplication

Two tests that appear together on every line and never apart walked the same code — likely one rendered state under two names.

```
  A+B │     <Chip label={section.name} …
```

A signal, not a verdict: different states can share code paths, so diff the captures before acting. Prefer making the states differ over deleting. A test that is the only letter on some line carries unique coverage — leave it. Nothing in the report flags this for you — reading the gutters is the whole method.

## Common mistakes

- Leaving a snapshot as a bare scaffold and calling it a baseline. Without the hand-typed screenshot field it records code coverage only, and every later comparison inherits that hole.
- Reading a `visibility-map.txt` end to end instead of grepping it for an anchor. They run to thousands of lines each.
- Reporting a code-coverage delta as the headline. The screenshot numbers are the finding; statements are the supporting detail.
- Producing any estimate at all when `coverage.json` is missing, instead of stopping and saying the bundle is uninstrumented.
- Expanding `relevant-sources` between the baseline and the current run.
- Treating a code-covered line as screenshot-covered without a visibility-map match.
- Adding a screenshot-field test letter that is absent from that line's coverage field.
- Throwing away the anchors after a run, so the next one re-derives the one part that took judgement.
- Averaging viewports, which hides that one valid screenshot fully covers an element.
- Reading a stale `audit-results/<dir>` picked by name instead of the ids in `report.json`.
- Letting subagents edit the shared estimate instead of returning independently reviewable evidence.
