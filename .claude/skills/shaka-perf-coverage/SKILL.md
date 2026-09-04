---
name: shaka-perf-coverage
description: Use when estimating Shaka Perf screenshot coverage from instrumented code coverage and audit visibility maps, comparing coverage with a saved baseline, or identifying duplicate A/B tests.
---

# shaka-perf-coverage

Estimate **screenshot coverage**: not "how many lines did the tests run", but "did the elements those lines render end up in a screenshot".

Shaka-perf is a performance framework, not a replacement for cypress/playwright. If you need 100% code coverage and want  to hunt edge cases, use some other tool. The reason is: shaka-perf is computationaly expensive. The cheapest run `shaka-perf compare --categories=visreg` runs the tests two times minumum. Also, it takes screenshots, so the slightest flakiness will cause retries. Shaka-perf is good for covering happy paths, and bad for covering every single use case.

Good A/B-test coverage is not `95% of lines covered`; it is `100% of the important elements are in a screenshot`. Code coverage is only one of the signals we use to get there.

# The most important thing

Depending on prompt, determine the full list of files with components you care about.
Again, shaka-perf is a screenshot tool, so ultimately the only thing we care are files with UI components.

Your one input is the **list of sources** to estimate. Everything else — which test executed which statement, what each screenshot showed of each element, and the join between the two — is read off the audit run by code.

## Getting the data

The `code_coverage` audit category writes, per test and viewport, `coverage.json` (which statements ran) and `visibility-map.txt` (how much of each rendered element falls inside the test's `visregSelectors`, and the app source line that rendered it) into `audit-results/<unit>/artifacts/`.

```bash
shaka-perf audit --categories code_coverage --url <dev build> --filter <relevant-tests>
```

Two things must hold, and both are the user's to fix, not yours to work around:

- **The bundle is instrumented.** The stage fails a unit whose page has no `window.__coverage__`. If it did, STOP and say so: the fix is `babel-plugin-istanbul`, `nyc instrument`, or `swc-plugin-coverage-instrument` (see `demo-ecommerce/config/rspack/clientWebpackConfig.js`). Never estimate around it — a visibility map alone says what is on screen, not which test's code put it there.
- **The build carries sources.** `codeCoverage.screenshotCoveragePlugin` is set in `abtests.config.ts`, and the audited URL serves a build the plugin can read (`'react19'` needs a DEVELOPMENT React build with a real source map; twin-servers serve production builds, so point `--url` at a dev server of the same code). `save` refuses a run whose maps locate no elements and quotes the map header that says why. Report that to the user; do not fall back to anything by hand.

## The loop

**save the before → make your change → re-audit → save the after → diff.**

```
node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"
node <skill-dir>/coverage-baseline.ts list
node <skill-dir>/coverage-baseline.ts diff                          # the last two snapshots
node <skill-dir>/coverage-baseline.ts diff <older-dir> <newer-dir>
```

`<relevant-sources>` is a comma-separated list of regexes matched against paths under `app/javascript`. Choosing it is the judgement this skill leaves to you: narrow enough to name the components in question, and **reused verbatim for every save** — changing it makes the diff meaningless. A regex that matches nothing fails loudly rather than reporting good news.

`save` writes a timestamped directory under `coverage-baselines/` — one file per source, mirroring its path, plus `legend.txt` mapping test letters to test names — and it is finished when the command returns. It never overwrites.

To snapshot a run whose `audit-results/` has since been overwritten: `AUDIT_ROOT=<stashed-dir> node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"`.

### Reading a snapshot

Each line is the source line, then its measurements as a trailing comment:

```text
<source line>  // <tests that executed it> | <what a screenshot showed>
```

```text
  return (                                          // A+B   |
    <nav className="site-nav" data-cy="main-nav">   //       | A=100%,B=0%
      <div className="slide">                       //       | A=33%:clipped-by-ancestor,B=0%
      <button onClick={openCart}>Cart</button>      // 0     |
```

- The coverage field sits on statement lines: `A+B` executed it, `0` no test reached it, blank means no statement starts there, `never loaded` means nothing fetched the chunk.
- The screenshot field sits on the ELEMENT's own line, one cell per test that executed the statement drawing it: the MAX share of the element a screenshot of that test showed, across its viewports — coverage asks whether ANY screenshot shows it. `0%` is a test that ran the code and showed none of the element. Below 100%, the dominant reason rides along:

| reason | what happened | what to do about it |
| --- | --- | --- |
| `not-rendered` | no box at all — `display:none`, never mounted, empty inline | the state the test leaves the page in never shows this element; drive the test to the state that does |
| `hidden-by-CSS` | `visibility:hidden`, `opacity:0`, or `content-visibility:hidden` | same — or it is a deliberate hide (a captcha, a transition end state) |
| `clipped-by-ancestor` | an ancestor's `overflow` crops it (carousel track, scroll box) | only the crop is coverage; scroll/advance the component in the test if the rest matters |
| `outside-capture` | it falls outside this test's `visregSelectors` region | widen `visregSelectors`, or use a taller viewport if it is below the fold |
| `obscured` | something is painted on top: modal, sticky bar, cookie banner (sampled, so approximate) | dismiss the overlay in the test body, or accept that this test cannot cover it |

- Source first, so the left of `//` is byte-identical between runs of the same commit; the coverage field is padded to the widest gutter in the run, so a line gaining a letter cannot move its neighbours. Together those make a diff show only the cells that changed.
- A source with high statement coverage and no element line above `0%` is the signature this skill exists to catch: the component runs and paints nothing. Chase the gate — a rollout flag, missing data, an early `return null` — before believing the coverage number.

### Reading a diff

`diff` writes `<newer>--vs--<older>.diff/`:

- **`summary.txt`** — per source, elements seen before → after → delta and at 0%, then statements covered. Read this first; it is usually the whole verdict.
- **one `.diff` per source, and ONLY for sources that changed.** The listing is the index: `ls` names the components that moved, `wc -l` ranks them.

**Lead every report with the screenshot numbers.** `seen → seen` answers the question this skill asks; `covered → covered` only says a test executed the code. When they disagree, the screenshot column is the truthful one.

- a percentage falling to `0%` while the coverage field never moved is a screenshot that stopped showing the element — usually a layout change pushing it out of the capture
- a line that gained a letter but stayed `0%` gained nothing a screenshot can show
- a letter leaving the legend means a test stopped touching these sources
- a MODULE-LEVEL statement gains letters when its chunk is fetched, not when the component renders — a `.diff` whose only changes sit outside function bodies moved no pixels
- two runs against DIFFERENT SERVERS can disagree on which line a statement starts; when whole files show as rewritten, compare per-file counts, not lines

## Coverage-based deduplication

Two tests that appear together on every line and never apart walked the same code — likely one rendered state under two names.

```
  A+B │     <Chip label={section.name} …
```

A signal, not a verdict: different states can share code paths, so diff the captures before acting. Prefer making the states differ over deleting. A test that is the only letter on some line carries unique coverage — leave it.

## Common mistakes

- Reporting a code-coverage delta as the headline. The screenshot numbers are the finding; statements are the supporting detail.
- Producing any estimate when `coverage.json` is missing or the maps locate nothing, instead of stopping and telling the user what the build lacks.
- Expanding `relevant-sources` between the baseline and the current run.
- Averaging viewports, which hides that one valid screenshot fully covers an element.
- Reading a stale `audit-results/<dir>` picked by name instead of the ids in `report.json` — the directory names are not chronological.
- Reading `visibility-map.txt` files by hand. The snapshot already holds what they say about your sources.
