# Task 8 Repair Report

## Status

- Repair complete for the owned Task 8 files.
- The design specification is `Implemented` after seeded-history live acceptance.
- The feature restores the experiment branch and SHA while leaving the control checkout fixed.

## Investigation

- `git show-ref --heads codex/git-bisect-demo-history` initially resolved the seed branch to `9520d2e448339c7e2149e539209ec56764890b97`.
- `git show --stat 9520d2e448339c7e2149e539209ec56764890b97` showed perf-engine and Lighthouse artifact changes outside the demo fixture history.
- `git show -s --format='tip=%H parent=%P subject=%s' 9520d2e` confirmed its parent is `780f5a55d4605cf501b1adb8e338b69ac81b06ff`, the latest demo-history documentation commit.
- `git show 780f5a5:demo-ecommerce/docs/git-bisect-seed-history.md` and the actual `homepage.abtest.ts` and `product-detail.abtest.ts` definitions confirmed the fixture names and subjects: `Homepage`, `Product Detail`, homepage hero selector, `button-name`, and `TBT` for both CPU warmups.
- `demo-ecommerce/abtests.config.ts` already contains the required dependency install and Rails asset precompile commands, so no config edit was needed.

## Seed Branch Ref

- Command: `git branch -f codex/git-bisect-demo-history 780f5a55d4605cf501b1adb8e338b69ac81b06ff`
- Old ref: `9520d2e448339c7e2149e539209ec56764890b97`
- New ref: `780f5a55d4605cf501b1adb8e338b69ac81b06ff`
- The current feature branch was not moved by this command.

## TDD Evidence

### RED

The fixture observations were changed to derive from independent commit-event metadata, then the expected homepage visual first-bad SHA was intentionally set to the clean commit `f2cd5c9016e5e758c335e4d5c90eb7bb1a01e4bf`.

Command:

```bash
yarn workspace shaka-perf test --runInBand packages/shaka-perf/src/compare/bisect/__tests__/seed-history.test.ts
```

Result: failed exactly because the independently generated scheduler result was `aa1b86ae9ab48392844741b2cd90249eab11a9de`, not the intentionally wrong expected SHA. The other four first-bad results matched.

### GREEN

After restoring the documented expectation to `aa1b86ae9ab48392844741b2cd90249eab11a9de`, the same command passed: 1 suite, 1 test.

## Documentation Corrections

- Documented no-ref defaults: control `HEAD` is good and experiment `HEAD` is bad.
- Documented the experiment build-manifest prerequisite and exact build command.
- Described `session.json` as diagnostic-only state with no V0 resume behavior.
- Reiterated that control remains fixed throughout the run.
- Documented experiment checkout, volume, and server restoration after success, failure, or interruption, with cleanup failures reported separately.
- Kept the design status Draft.

## Verification

- `yarn workspace shaka-perf test --runInBand packages/shaka-perf/src/compare/bisect/__tests__/seed-history.test.ts` — PASS, 1 suite and 1 test.
- Initial isolated-worktree typechecks reported unresolved workspace package declarations because package outputs had not been built there.
- `yarn workspace shaka-shared build && yarn workspace shaka-bundle-size build` — PASS.
- `yarn workspace demo-ecommerce typecheck` — PASS after dependency builds.
- `yarn workspace shaka-perf typecheck` — PASS after dependency builds.
- `git diff --check` — PASS.
- Live seeded-history acceptance — PENDING; deliberately not run or claimed.

## 2026-07-12 Demo-Only Seed History Rewrite

- Supersedes the prior seed-history SHA references after the shared `codex/git-bisect-demo-history` branch was rewritten to the demo-only tip `f7b872f2a6d5817be15261b4d9f21a4f6814126f`.
- The deterministic fixture now starts at `38dae6871b8b443dd1880269dacde951700e77cc` and includes every one of the 17 commits from `git rev-list --reverse 38dae687..codex/git-bisect-demo-history`, including the clean documentation checkpoints.
- Documented first-bad results are homepage visual `58cc828b7272cd69408fa4dc5cd36206dcd8846a`, homepage perf `9c7cfff6c0ca9bd561f5bb9905a1b09ee3132d1e`, homepage accessibility `fcb0e2b107a99c6e4edab01da114d4d83b3d7a94`, and product-detail visual/perf `5345dffb62b761b9cb0e1516a6bbd4389a6cf642`.

### Rewrite TDD Evidence

- RED: after replacing only the ordered commit and event metadata while retaining the prior expected SHAs, `yarn workspace shaka-perf test --runInBand packages/shaka-perf/src/compare/bisect/__tests__/seed-history.test.ts` failed with all five received first-bad SHAs equal to the rewritten values above.
- GREEN: after updating the expected first-bad SHAs, the same focused test passed: 1 suite and 1 test.
- Broader verification: all bisect tests passed (8 suites, 70 tests); `yarn workspace shaka-perf typecheck` and `git diff --check` passed.

## 2026-07-13 Live Asset Refresh Correction

- Live acceptance proved that incremental `assets:precompile` retained old Rspack runtime mappings in `public/packs` and `tmp/cache`: the bad-ref source and new lazy chunks were present, but experiment Lighthouse artifacts still requested the control-era homepage and product-detail chunk hashes.
- The demo rebuild command now removes those persistent build outputs before precompiling so every checked-out candidate serves a self-consistent manifest and runtime.
- RED: the seed-history fixture test required the cache-clearing command and failed against the prior incremental command.
- GREEN: the focused seed-history fixture passed after updating the demo configuration.

## 2026-07-13 Live Seeded-History Acceptance

- The all-category run discovered 12 independent targets and narrowed them by category and AB-test file across the 17-commit demo-only history.
- It found homepage visual targets at `58cc828b7272cd69408fa4dc5cd36206dcd8846a`, homepage LCP, Lighthouse score, and TBT targets at `9c7cfff6c0ca9bd561f5bb9905a1b09ee3132d1e`, and product-detail visual plus all discovered perf targets at `5345dffb62b761b9cb0e1516a6bbd4389a6cf642`.
- The homepage speed-index observation resolved later at the combined product regression commit, demonstrating that non-deterministic Lighthouse metrics can classify differently from the fixture's deterministic CPU target. The deterministic homepage TBT target resolved at the intended performance commit.
- The run exposed a race in experiment restart cleanup at the final accessibility midpoint: killing the in-container command before stopping its Overmind process could terminate the entire Overmind session.
- RED: the focused twin-server lifecycle test required `overmind stop` before in-container PID cleanup and failed against the prior cleanup-first order.
- GREEN: the lifecycle now stops only experiment-owned Overmind processes, cleans tracked in-container sessions, and restarts those processes. The focused suite passed with 12 tests.
- A clean accessibility-only live rerun completed successfully, found homepage `button-name` first bad at `fcb0e2b107a99c6e4edab01da114d4d83b3d7a94`, restored `codex/compare-bisect-v0` at `cef027131cc0f74348e64dac083ded6cd955a020`, kept control at `38dae6871b8b443dd1880269dacde951700e77cc`, and left both server URLs returning HTTP 200.

## 2026-07-13 Post-Review Hardening

- Independent review identified missing bad-ref observations, uncertain volume state after partial materialization, skipped refresh after restoration failures, and missing post-`SIGKILL` exit verification.
- Added bad-ref observations to every discovered target so summaries retain the requested category values and artifact paths at the regression endpoint.
- A failed materialization now marks volume state uncertain and forces full reconciliation during restoration instead of deriving a delta from an incompletely copied candidate.
- Checkout, volume synchronization, and experiment refresh restoration are best-effort cleanup steps: refresh is still attempted after checkout or sync failure, and all cleanup errors are retained.
- Experiment process cleanup now polls after `SIGKILL` and refuses to restart Overmind while a tracked session remains alive.
- Follow-up review caught an adjacent good/bad range edge case: bad-ref evidence is now recorded without finalizing the target before the good endpoint is validated.
- RED/GREEN coverage was added for each case. The focused bisect and lifecycle suite passed with 9 suites and 86 tests, followed by a successful package typecheck.
- A final live accessibility bisect completed at `a0c0569b5e93bda020be24671e7161d9e42970cb`, again found `button-name` at `fcb0e2b107a99c6e4edab01da114d4d83b3d7a94`, restored the feature branch, kept control fixed, and left both URLs at HTTP 200. Its summary includes the bad-ref `button-name` values and all three accessibility artifact paths.
