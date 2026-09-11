---
name: shaka-perf-add-coverage
description: Use when source code is available and the user asks to add ShakaPerf A/B tests or improve A/B tests coverage for specified UI components or rendered states. Also use when asked to deduplicate A/B tests. Also use when asked to measure FE performance.
argument-hint: what elements to cover. Might be path or textual description of a component or a set of components.
---

# shaka-perf-add-coverage
Your goal is to add tests without unnecessarily bloating the test suite. The endgoal is all the interested components should be screenshoted without duplication (happy paths only).

**REQUIRED SUB-SKILL:** Use `shaka-perf-coverage` to estimate coverage, save the pre-edit baseline, read snapshots, and compare the final coverage.

## The loop
0. Run `shaka-perf audit --help`, `shaka-perf compare --help`, and `shaka-perf troubleshoot --help`
1. IMPORTANT find other ab tests that cover this element already. Produce a comma-separated tests filter (referenced as `relevant-tests`).
1.a Produce `relevant-sources` for the components under test (defined in `shaka-perf-coverage`). Keep it narrow and identical across baseline comparisons. A source missing from it is a hole you will never see.
2. Use skill `/shaka-perf-coverage` to audit `relevant-tests` and save the BEFORE baseline for `relevant-sources`, before editing tests.
3. If the element is fully covered by estimated coverage, check it is actually visible on screenshots: 
    - 3.a. Find the element's line in the snapshot and read its screenshot cell and reason (table in `shaka-perf-coverage`).
    - 3.b. Use `shaka-perf troubleshoot` when the snapshot is ambiguous or you need to see the live page — occlusion is a sampled estimate, measured only inside the current viewport. Wait for the `Test completed` log entry before inspecting.
    - 3.c. Generate screenshots with `shaka-perf compare --categories=visreg --filter=<relevant-tests> --controlURL=<experiment-url>` and review the screenshots visually.
4. If the screenshot cell is below 100%, fix it per the reason table. If the element is dead code, DO NOT EDIT PROD FILES TO MAKE IT RENDERED.
5. If these fixes are not enough for the coverage and you genuinely need to add more tests, write them and add them to `relevant-tests`.
6. If `relevant-tests` violate any rules in `writing-good-ab-tests.md`, fix them
7. Run `shaka-perf compare --categories=visreg --filter=<relevant-tests> --controlURL=<experiment-url> --burn 3` and fix all the flakiness coming from tests themselves. Do not fix flaky errors on the page or in the server, instead let the user know there is a bug and give them reproduction cmd (the failing --burn command you were running). Tell them that the problem is in the App, not in the tests.
8. Scan steps 3-6 using a subagent to make it adversarial, see if you missed somethings
9. Re-audit, save the AFTER baseline, and `diff` it against the BEFORE (per `shaka-perf-coverage`). Restart from 3 with the AFTER as the new BEFORE.

Stop the loop when all the components are fully covered by hi-quality tests that don't flake.

Caveat: `audit-results/` and `compare-results/` keep unit dirs from earlier filtered runs and their names are not chronological; read only the ids listed in each run's `report.json`.
