## 2026-07-12 Task 7 repair

### Files

- `packages/shaka-perf/src/compare/bisect/session.ts`
- `packages/shaka-perf/src/compare/bisect/run-candidate.ts`
- `packages/shaka-perf/src/compare/bisect/analyze.ts`
- `packages/shaka-perf/src/compare/bisect/cli.ts`
- `packages/shaka-perf/src/compare/cli/program.ts`
- `packages/shaka-perf/src/compare/compare-pipeline.ts`
- `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`
- `packages/shaka-perf/src/compare/bisect/__tests__/analyze.test.ts`
- `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`
- `packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts`
- `.superpowers/sdd/task-7-report.md`

### Implementation

- Added `runBisect(options)` and extracted public `runCandidate(options)` into `run-candidate.ts`.
- Installed scoped `SIGINT`/`SIGTERM` handlers that set a cancellation flag, defer interruption until safe checkpoints, and remain active through checkout/volume/server restoration and lease release.
- Persisted running state immediately and after checkout, materialization, refresh, compare, cached-boundary normalization, good-boundary validation, and candidate-boundary updates.
- Persisted actual refresh mode/fallback metadata before compare, preserving it when compare fails.
- Rejected every pipeline result containing an error outcome before target discovery or observation, so mixed valid/error data cannot move boundaries.
- Delayed complete state and summary writes until original checkout/volume/server restoration and lease release succeed; cleanup failures persist failed state and omit summary.
- Restored and refreshed the original experiment even when its SHA matches the last candidate, while retaining `dockerBuildDir` as the synchronization source from `761d91b`.
- Shared parsed-config-to-pipeline construction between bare compare and bisect, loaded config/tests once, and forwarded inherited control/experiment URL overrides.
- Preserved control-good validation, narrowed candidate work, cached midpoint reuse, per-SHA artifact roots, and Task 6 typed bisect refresh integration.

### RED commands and output

- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/analyze.test.ts --runInBand`
  - RED: `TS2305` because `assertNoPipelineErrors` did not exist.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts --runInBand`
  - RED: mixed valid/error bad data advanced into good measurement instead of rejecting the bad result.
  - RED: `TS2353` because signal-handler installation was absent from orchestration dependencies.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts --runInBand`
  - RED: injected CLI runner received the raw `Command` instead of inherited config/filter/category/headed/URL options.
  - RED: `TS2554` because CLI config/test loading was not dependency-injectable for the load-once contract.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts --runInBand`
  - RED: `TS2305` because the shared parsed-config pipeline helper did not exist.

### GREEN commands and output

- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts --runInBand`
  - PASS: 2 suites, 15 tests.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__ --runInBand`
  - PASS: 8 suites, 63 tests.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts --runInBand -t 'derives reusable pipeline construction options'`
  - PASS: 1 focused helper test.
- `yarn workspace shaka-shared run build`
  - PASS.
- `yarn workspace shaka-perf run typecheck`
  - PASS.
- `git diff --check`
  - PASS.

### Concerns

- A full run of the existing compare-pipeline test file was attempted but its measurement test timed out waiting for the controller's live `compare bisect` measurement lock (`pid 16774`). The new shared-construction test passes when selected directly; the required focused and all-bisect suites are green. The live process and main checkout were left untouched.
