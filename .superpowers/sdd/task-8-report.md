# Task 8 Repair Report

## Status

- Repair complete for the owned Task 8 files.
- The design specification remains `Draft for user review` because controller live acceptance is still pending.
- Live acceptance was not run during this repair. The active twin-server menu was left untouched.

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
