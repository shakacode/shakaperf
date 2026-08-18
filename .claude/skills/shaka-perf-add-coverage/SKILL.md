---
name: shaka-perf-add-coverage
description: Use when source code is available and the user asks to add or improve Shaka Perf A/B visual-regression coverage for specified UI components or rendered states. Also use when asked to deduplicate A/B tests.
argument-hint: what elemments to cover. Might be path or textual description of a component or a set of components.
---

# shaka-perf-add-coverage
Your goal is to add tests without unnecessarily bloating the test suite. The endgoal is all the interested components should be screenshoted without duplication.

## The loop
0. Run `shaka-perf audit --help`, `shaka-perf compare --help`, and `shaka-perf troubleshoot --help`
1. IMPORTANT find other ab tests that cover this element already. Produce a comma-separated tests filter (referenced as `relevant-tests`).
1.a Produce a comma-separated list of regexes for the components under test, matched against paths under `app/javascript` (referenced as `relevant-sources`). Both scripts below take it as their first argument. Keep it in sync as you add tests — a source missing from it is a hole you will never see.
2. Run `shaka-perf audit --skip-stages accessibility,agent-readiness,ai_summary,build_annotated_timeline --filter <relevant-tests>`
3. Look at the code coverage produced in `audit-results` both cumulative and per-tests (referenced as `existing-coverage`). Note: cumulative code coverage is calculated for all the tests included in the last audit run.
  3.a If no code coverage, or seeing bugs in the generated code coverage, halt this skill and instruct the user to add instrumented code coverage compatible with shaka-perf.
4. If the element is fully covered by existing-coverage, check it is actually visible on screenshots. Use `shaka-perf troubleshoot` and check the following things:
  4.a The element is rendered at the end of the test. Wait for `Test completed` log entry before checking. If the element only appears transactionally it will never end up on the screenshot.
  4.b The element is visible in the bounding rect of visregSelectors
  4.c The element is not obscured by overlapping elements or dialogs
  4.e The element or it's parts are not hidden by CSS (with the exception of things like captcha)
  4.f Check all viewports
5. If seeing any of the issues in 4, fix them. If the element is dead code, DO NOT EDIT PROD FILES TO MAKE IT RENDERED. 
6. If these fixes are not enough for the coverage and you genuinely need to add more tests, write them and add them to `relevant-tests`.
7. If `relevant-tests` violate any rules in `writing-good-ab-tests.md`, fix them
8. Run `shaka-perf compare --categories=visreg --filter=<relevant-tests> --burn 3` and fix all the flakiness coming from tests themselves (do not fix flaky errors on the page or server)
9. Scan steps 4-7 using a subagent to make it adversarial, see if you missed somethings
10. Restart from 2

Stop the loop when all the components are fully covered by hi-quality tests that don't flake.

Caveat: `compare-results/` and `audit-results/` keep old runs and their names are not chronological, so pick the newest by `mtime` or you will read stale screenshots and stale coverage.


## About code coverage
Shaka-perf is not your usual test framework. It's a performance framework, not a replacement for cypress/playwright and so it doesn't need to hunt edge cases.
So when we say good ab tests coverage, we don't mean `95% lines covered in the code base`. We mean `100% of all important elements are screenshoted by ab tests`.
We don't care about `code coverage` we use it as a signal to estimate `screenshot coverage`
Use `view-coverage.js` (next to this file) for step 1-2. It prints the source with the tests that executed each line, keyed to a legend:

```
node <skill-dir>/view-coverage.js "<relevant-sources>"
```

`0` is a statement no test reached, `never loaded` means nothing fetched the chunk. Sources are discovered by walking `app/javascript`, so a regex that matches nothing says so instead of silently reporting good news.

The main thing is `good coverage` is not a mechanically produced percentage, it's the abscence of objective holes in the resulting screenshots, and you have to use your judgement while executing the loop. 

KEEP IN MIND!!! THE OUTPUT IS NOT SCREENSHOT COVERAGE! IT IS CODE COVERAGE! SCREENSHOT COVERAGE SHOULD BE JUDGED BY RUNNING TROUBLESHOOT

## Coverage-based deduplication

Two tests that appear together on every line and never apart walked the same code — likely one rendered state under two names.

```
  A+B │     <Chip label={section.name} …
```

A signal, not a verdict: different states can share code paths, so diff the captures before acting. Prefer making the states differ over deleting. A test that is the only letter on some line carries unique coverage — leave it.

## Judging a change in coverage

`coverage-baseline.ts` snapshots `view-coverage.js` output. Save before your edits, then diff — it re-reads coverage now and compares, in the same gutter format.

```
node <skill-dir>/coverage-baseline.ts save "<relevant-sources>"
node <skill-dir>/coverage-baseline.ts list
node <skill-dir>/coverage-baseline.ts diff "<relevant-sources>"                    # vs newest
node <skill-dir>/coverage-baseline.ts diff "<relevant-sources>" <snapshot-file>    # vs an older one
```

`save` never overwrites; every run adds a timestamped file under `coverage-baselines/`. `diff` regenerates coverage from the latest audit run and compares; it warns if the snapshot was saved with different sources. A letter turning into `0` is coverage lost on that line, `0` turning into a letter is coverage gained, and a letter leaving the legend means a test stopped touching these sources.
