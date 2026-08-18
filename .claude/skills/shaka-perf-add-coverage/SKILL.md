---
name: shaka-perf-add-coverage
description: Use when source code is available and the user asks to add or improve Shaka Perf A/B visual-regression coverage for specified UI components or rendered states. Also use when asked to deduplicate A/B tests.
argument-hint: what elemments to cover. Might be path or textual description of a component or a set of components.
---

# shaka-perf-add-coverage
Your goal is to add tests without unnecessarily bloating the test suite. The endgoal is all the interested components should be screenshoted without duplication.

**REQUIRED SUB-SKILL:** Use `shaka-perf-coverage` to estimate coverage, save the pre-edit baseline, inspect visibility maps, and compare the final coverage.

## The loop
0. Run `shaka-perf audit --help`, `shaka-perf compare --help`, and `shaka-perf troubleshoot --help`
1. IMPORTANT find other ab tests that cover this element already. Produce a comma-separated tests filter (referenced as `relevant-tests`).
1.a Produce a comma-separated list of regexes for the components under test, matched against paths under `app/javascript` (referenced as `relevant-sources`). Keep it narrow and keep it identical across baseline comparisons. A source missing from it is a hole you will never see.
2. Run `shaka-perf audit --categories code_coverage --filter <relevant-tests>`. 
3. Use `shaka-perf-coverage` to create estimated coverage for `relevant-sources`, both cumulative and per-test, and save a baseline before editing tests. Note: cumulative code coverage is calculated for all the tests included in the last audit run.
  3.a If no code coverage, or seeing bugs in the generated code coverage, HALT and tell the user their bundle needs instrumenting (babel-plugin-istanbul / `nyc instrument` / `swc-plugin-coverage-instrument`). Do not continue the loop on visibility maps alone: they say what is on screen, never which test's code put it there, so any coverage claim built from them is invented. Wait for the user.
4. If the element is fully covered by estimated coverage, check it is actually visible on screenshots. Each unit's `artifacts/visibility-map.txt` answers most of this without opening a browser — find the element's line and read its percentage and reason:
  4.a `not rendered` — the element is absent at the END of the test. If it only appears transiently it will never reach the screenshot.
  4.b `outside capture` — it falls outside the bounding rect of `visregSelectors`.
  4.c `obscured` — an overlapping element or dialog is painted over it.
  4.d `clipped by ancestor` — an ancestor's `overflow` crops it.
  4.e `hidden by CSS` — visibility/opacity/content-visibility (captcha-like deliberate hides are fine).
  4.f Check every viewport: there is one map per (test, viewport), and a test covers the element if ANY of them shows it.
  4.g Use `shaka-perf troubleshoot` when the map is ambiguous or you need to see the live page — occlusion in the map is a sampled estimate, and it is only measured inside the current viewport. Wait for the `Test completed` log entry before inspecting.
5. If seeing any of the issues in 4, fix them. If the element is dead code, DO NOT EDIT PROD FILES TO MAKE IT RENDERED.
6. If these fixes are not enough for the coverage and you genuinely need to add more tests, write them and add them to `relevant-tests`.
7. If `relevant-tests` violate any rules in `writing-good-ab-tests.md`, fix them
8. Run `shaka-perf compare --categories=visreg --filter=<relevant-tests> --burn 3` and fix all the flakiness coming from tests themselves (do not fix flaky errors on the page or server)
9. Scan steps 4-7 using a subagent to make it adversarial, see if you missed somethings
10. Restart from 2

Stop the loop when all the components are fully covered by hi-quality tests that don't flake.

Caveat: `compare-results/` and `audit-results/` keep old runs and their names are not chronological, so pick the newest by `mtime` or you will read stale screenshots and stale coverage.
