# Compare Bisect Merge and Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-parent merge support, one-level optional merge-source investigation, and safe version-2 resume semantics to `shaka-perf compare bisect` without running the real bisect pipeline.

**Architecture:** Persist a version-2 root session containing a generic primary search phase, child search phases, repository/config compatibility evidence, merge queue state, and append-only candidate attempts. Primary and child searches share the existing target scheduler through one phase runner; merge orchestration and resume validation remain focused modules rather than phase-name switches in shared code.

**Tech Stack:** TypeScript strict mode, Zod, Commander.js, Node.js Git subprocesses and crypto, Jest, React 19 report shell, Vite single-file reports, Yarn 4.

## Global Constraints

- Work only in `/Users/ramezweissa/code/shaka/.codex/worktrees/compare-bisect-merge-resume` on `codex/compare-bisect-merge-resume`.
- Preserve first-bad target intervals, cached observations, category independence, and exact `{ testFile, testName }` selections.
- The primary range uses first-parent history and treats every merge atomically.
- Complete and report the full primary search before any merge-source investigation.
- Investigate only two-parent primary first-bad merges and never recurse beyond one child level.
- Resume only version-2 state; reject version 1 clearly.
- Validate resume compatibility before acquiring a twin-server lease or mutating checkouts.
- The first resumed materialization uses full manifest reconciliation; later candidates use normal deltas.
- Incomplete attempts never move target bounds; completed comparisons are not repeated.
- Use small logical commits matching the design spec.
- Never run a real `shaka-perf compare bisect` or compare pipeline invocation.
- Final verification includes focused tests, the complete relevant suite, `yarn build`, and `git diff --check`.

---

### Task 1: First-Parent Git Ranges and Merge Metadata

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/git.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts`

**Interfaces:**
- Produces: `PreparedGitRange.commitParents: Record<string, string[]>`.
- Produces: `prepareChildGitRange(experimentDir, firstParent, secondParent): Promise<PreparedChildGitRange>`.
- Preserves: clean-checkout validation, immutable SHA resolution, control-good equality, and checkout restoration.

- [ ] **Step 1: Write failing merge topology tests**

Build temporary histories containing a two-parent merge, an octopus merge, and a nested merge. Assert the primary range is exactly the first-parent sequence and parent arrays preserve topology:

```ts
expect(prepared.orderedCommits).toEqual([goodSha, mainlineSha, mergeSha, badSha]);
expect(prepared.commitParents[mergeSha]).toEqual([mainlineSha, topicSha]);
```

Assert `prepareChildGitRange()` returns `mergeBase`, `secondParent`, first-parent ordered commits, subjects, and parent arrays.

- [ ] **Step 2: Run Git tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/git.test.ts --runInBand
```

Expected: existing merge-rejection expectations fail and the new metadata/functions do not exist.

- [ ] **Step 3: Implement first-parent loaders**

Replace linear traversal with:

```ts
const orderedOutput = await git(repoDir, [
  'rev-list', '--first-parent', '--reverse', `${goodSha}..${badSha}`,
]);
```

Load metadata once with `%H%x00%P%x00%s`, parsing parents and subjects into stable maps. Implement child preparation with `git merge-base <first> <second>` and the same first-parent loader. Do not reject merge commits.

- [ ] **Step 4: Run Git tests and verify GREEN**

Run the Task 1 command. Expected: all Git tests pass.

- [ ] **Step 5: Commit Git behavior**

```bash
git add packages/shaka-perf/src/compare/bisect/git.ts packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts
git commit -m "feat(compare): traverse bisect merges by first parent"
```

### Task 2: Version-2 State, Schemas, Fingerprints, and Atomic Inputs

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/types.ts`
- Create: `packages/shaka-perf/src/compare/bisect/state.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/persistence.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/state.test.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`

**Interfaces:**
- Produces: version-2 `BisectSession`, `BisectSearchPhase`, `CommitAttempt`, compatibility, identity, and merge result types.
- Produces: `readBisectSession(filePath): BisectSession` with Zod validation and v1-specific rejection.
- Produces: `buildCompatibility(input): BisectCompatibility` and `assertCompatible(saved, current): void`.
- Produces: atomic `writeBadRefTests()` / `readBadRefTests()` with digest validation.

- [ ] **Step 1: Write failing state tests**

Assert:

```ts
expect(() => parseBisectSession({ version: 1 })).toThrow(/predates resumable state/i);
expect(parseBisectSession(version2Fixture)).toEqual(version2Fixture);
expect(() => assertCompatible(saved, changedConfig)).toThrow(/configuration changed/i);
expect(() => assertCompatible(saved, changedCategories)).toThrow(/selected categories changed/i);
```

Cover repository path/common-dir/origin mismatches, test fingerprint drift, range drift, rebuild strategy drift, dirty/moved checkout messages, and running-attempt normalization to incomplete.

- [ ] **Step 2: Run state tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/state.test.ts src/compare/bisect/__tests__/persistence.test.ts --runInBand
```

Expected: new modules/types/functions are missing.

- [ ] **Step 3: Implement version-2 types and Zod schema**

Define the exact types from the design spec. Use `z.object(...).strict()` at persisted boundaries. Keep one deserialization function that maps parsed phase data to the live generic runner input; shared scheduling must not branch on phase names.

- [ ] **Step 4: Implement stable fingerprints and compatibility errors**

Use SHA-256 over a recursively key-sorted JSON representation:

```ts
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
```

Persist both hashes and concise effective values. `assertCompatible()` checks fields in actionable order and names the mismatch.

- [ ] **Step 5: Implement atomic session/report-input persistence**

Write `session.json` and `bad-ref-tests.json` with temporary-file plus rename semantics. Store and validate the bad-ref input digest before resume work.

- [ ] **Step 6: Run state tests and verify GREEN**

Run the Task 2 command. Expected: all state/persistence tests pass.

- [ ] **Step 7: Commit resumable state primitives**

```bash
git add packages/shaka-perf/src/compare/bisect/types.ts packages/shaka-perf/src/compare/bisect/state.ts packages/shaka-perf/src/compare/bisect/persistence.ts packages/shaka-perf/src/compare/bisect/__tests__/state.test.ts packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts
git commit -m "feat(compare): persist resumable bisect state"
```

### Task 3: Generic Search Phase and Attempt Checkpointing

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/phase.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/search.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/run-candidate.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/phase.test.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`

**Interfaces:**
- Produces: `runSearchPhase(options): Promise<BisectSearchPhase>`.
- Consumes: one phase, `measure(work)`, `checkpoint(phase)`, and `now()` callbacks.
- Produces: complete/incomplete `CommitAttempt[]`; observations apply only inside the successful atomic checkpoint.

- [ ] **Step 1: Write failing phase tests**

Test multiple category targets, cached midpoint observations, exact test batching, and divergent intervals through the generic phase API. Verify one incomplete attempt followed by a resumed complete attempt for the same SHA:

```ts
expect(phase.attempts.map(({ sha, status }) => ({ sha, status }))).toEqual([
  { sha: midpoint, status: 'incomplete' },
  { sha: midpoint, status: 'complete' },
]);
```

Assert no observation or bound changes after the incomplete attempt and no measure call for already completed target/SHA observations.

- [ ] **Step 2: Run phase/session tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/phase.test.ts src/compare/bisect/__tests__/session.test.ts --runInBand
```

- [ ] **Step 3: Implement the generic phase runner**

Move the midpoint loop behind:

```ts
export interface RunSearchPhaseOptions {
  phase: BisectSearchPhase;
  measure(work: CandidateWork): Promise<CandidateResult>;
  checkpoint(phase: BisectSearchPhase): void;
  now(): string;
}
```

The runner uses `applyCachedObservations`, `nextCandidate`, and `applyObservations` without inspecting a phase kind. Checkpoint a running attempt before measure; on success checkpoint completed attempt plus observations/bounds; on failure checkpoint incomplete and rethrow.

- [ ] **Step 4: Adapt primary orchestration**

Construct `session.primary`, retain bad/good endpoint handling, and invoke `runSearchPhase`. Keep report/session cleanup ordering and target behavior intact.

- [ ] **Step 5: Run phase/session tests and verify GREEN**

Run the Task 3 command.

- [ ] **Step 6: Commit the phase engine**

```bash
git add packages/shaka-perf/src/compare/bisect/phase.ts packages/shaka-perf/src/compare/bisect/search.ts packages/shaka-perf/src/compare/bisect/run-candidate.ts packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/__tests__/phase.test.ts packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts
git commit -m "refactor(compare): run bisect through resumable phases"
```

### Task 4: Resume Validation and Full First Reconciliation

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/git.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/state.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/sync.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/state.test.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/sync.test.ts`

**Interfaces:**
- Produces: `prepareResume(...)` that validates state before returning execution input.
- Produces: resume execution with `materializedSha = null` and no lease when no work remains.

- [ ] **Step 1: Write failing resume-order tests**

Assert incompatible/dirty/moved state rejects before `beginSession`, `checkout`, or persistence mutation. For a compatible interrupted session, assert event order:

```ts
expect(events).toEqual(expect.arrayContaining([
  'validate', 'lease:begin', 'checkout:b', 'reconcile:b', 'refresh:b',
]));
expect(events.indexOf('reconcile:b')).toBeLessThan(events.indexOf('refresh:b'));
```

Assert the next candidate uses `syncCommitDelta` after the first full reconcile and completed comparisons are absent from compare calls.

- [ ] **Step 2: Run resume tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/state.test.ts src/compare/bisect/__tests__/session.test.ts src/compare/bisect/__tests__/sync.test.ts --runInBand
```

- [ ] **Step 3: Implement repository identity and resume preparation**

Read canonical roots/common dirs/origin URLs and current checkout states. Validate the saved state, bad-ref input digest, config/test/category/rebuild fingerprints, cleanliness, control good SHA, and original experiment state before creating default execution dependencies.

- [ ] **Step 4: Force first resumed full reconciliation**

Initialize resumed `materializedSha` to null even if a prior attempt recorded a SHA. The existing materializer branch must call `reconcileExperimentVolume()` for null and `syncCommitDelta()` only after the first successful materialization.

- [ ] **Step 5: Run resume tests and verify GREEN**

Run the Task 4 command.

- [ ] **Step 6: Commit resume execution**

```bash
git add packages/shaka-perf/src/compare/bisect/git.ts packages/shaka-perf/src/compare/bisect/state.ts packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/sync.ts packages/shaka-perf/src/compare/bisect/__tests__/state.test.ts packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts packages/shaka-perf/src/compare/bisect/__tests__/sync.test.ts
git commit -m "feat(compare): resume bisect sessions safely"
```

### Task 5: Merge Queue and One-Level Child Investigations

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/merge-investigation.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/merge-investigation.test.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`

**Interfaces:**
- Produces: `buildMergeQueue(session): BisectSession` after primary completion.
- Produces: `runMergeInvestigations(options): Promise<BisectSession>`.
- Consumes: `prepareChildGitRange`, the generic phase runner, and the same measure/checkpoint dependencies as primary.

- [ ] **Step 1: Write failing classification tests**

Cover:

- all primary targets finish before the first child compare;
- initial report/session checkpoint occurs before child work;
- second-parent absence yields `merge-introduced` per target;
- reproducing targets share the child midpoint run and can resolve to different source commits;
- a child first-bad merge yields `nested-merge` without creating another queue entry;
- an octopus primary merge yields `octopus-unsupported` with zero child compares;
- interrupted child work resumes from cached observations.

- [ ] **Step 2: Run merge tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/merge-investigation.test.ts src/compare/bisect/__tests__/session.test.ts --runInBand
```

- [ ] **Step 3: Build the primary merge queue**

Group found primary targets by `firstBadSha`, retain only commits with multiple parents, order by the primary range, and initialize target results. Mark three-or-more-parent records `octopus-unsupported` immediately.

- [ ] **Step 4: Implement two-parent investigations**

Measure the second parent once for the merge's active targets. Classify absent targets `merge-introduced`; create a child phase for reproducing targets, run it through `runSearchPhase`, and map child first-bad commits to `source-found` or `nested-merge` from child parent metadata. Never call `buildMergeQueue()` for child phases.

- [ ] **Step 5: Enforce primary-report-before-child ordering**

Checkpoint primary completion, queue state, summary, and report before invoking `runMergeInvestigations`, including when the initial command passed `--investigate-merges`.

- [ ] **Step 6: Run merge tests and verify GREEN**

Run the Task 5 command.

- [ ] **Step 7: Commit merge investigations**

```bash
git add packages/shaka-perf/src/compare/bisect/merge-investigation.ts packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/__tests__/merge-investigation.test.ts packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts
git commit -m "feat(compare): investigate bisect merge sources"
```

### Task 6: CLI, Reporting, Schemas, and Documentation

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/cli.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/persistence.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/report-model.ts`
- Modify: `packages/shaka-perf/report-shell/src/report-data.ts`
- Modify: `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`
- Modify: `packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx`
- Modify: `packages/shaka-perf/report-shell/src/styles.css`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`
- Modify: `packages/shaka-perf/test/compare/bisect-report-ui_spec.ts`
- Modify: `packages/shaka-perf/README-compare-bisect.md`
- Modify: `docs/superpowers/specs/2026-07-12-compare-bisect-design.md`
- Include: `docs/superpowers/plans/2026-07-13-compare-bisect-merge-resume.md`

**Interfaces:**
- Adds CLI options `resume` and `investigateMerges`.
- Extends summary/report target schemas with mainline merge and source result fields.
- Preserves report artifact cards and category/test/viewport/value identity.

- [ ] **Step 1: Write failing CLI and report tests**

Assert flag parsing, invalid resume combinations, missing/v1/incompatible session messages, no-work resume behavior, and the exact follow-up command. Extend model/schema/UI fixtures with merge-uninvestigated, source-found, merge-introduced, nested-merge, and octopus-unsupported targets.

- [ ] **Step 2: Run CLI/report tests and verify RED**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/cli.test.ts src/compare/bisect/__tests__/persistence.test.ts src/compare/bisect/__tests__/report-model.test.ts src/compare/bisect/__tests__/app-report.test.ts test/compare/bisect-report-ui_spec.ts --runInBand
```

- [ ] **Step 3: Implement CLI and terminal behavior**

Add Commander flags, pass them through runtime options, validate combinations before loading/mutating session state, and print the exact follow-up command for any `merge-uninvestigated` target.

- [ ] **Step 4: Extend JSON/report schemas and model**

Add `mainlineFirstBadSha`, `mainlineIsMerge`, `mergeInvestigationStatus`, `mergeSourceSha`, and `mergeResult` to the report target model and Zod payload. Map merge parent metadata and target results from session state.

- [ ] **Step 5: Render merge outcomes**

Add a merge badge/state to primary commit nodes. In target details render mainline commit, investigation status, and source commit/result while retaining existing bad-ref values and cards. Keep keyboard/focus and phone-flow behavior covered by browser acceptance.

- [ ] **Step 6: Update README and original design**

Document first-parent primary behavior, atomic merges, exact follow-up/resume commands, one-level child rules, v2 compatibility checks, attempts, full first reconciliation, statuses, output files, and recovery messages. Remove statements that V0 rejects merges or cannot resume.

- [ ] **Step 7: Run CLI/report tests and verify GREEN**

Run the Task 6 command.

- [ ] **Step 8: Commit user-facing merge/resume support**

```bash
git add packages/shaka-perf/src/compare/bisect packages/shaka-perf/report-shell/src packages/shaka-perf/test/compare/bisect-report-ui_spec.ts packages/shaka-perf/README-compare-bisect.md docs/superpowers/specs/2026-07-12-compare-bisect-design.md docs/superpowers/plans/2026-07-13-compare-bisect-merge-resume.md
git commit -m "feat(compare): report resumable merge bisects"
```

### Task 7: Full Verification and Requirement Audit

**Files:**
- Review all files changed since `f7bdae4`.

- [ ] **Step 1: Run focused changed-area tests**

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__ test/compare/bisect-report-ui_spec.ts --runInBand
```

- [ ] **Step 2: Run the complete relevant package suite**

```bash
yarn workspace shaka-perf test --runInBand
```

- [ ] **Step 3: Run the required monorepo build**

```bash
yarn build
```

- [ ] **Step 4: Audit state and prohibited behavior**

```bash
git diff --check
git status --short --branch
git log --oneline e7464141..HEAD
rg -n "Bisect range must be linear|cannot resume|V0 cannot resume" packages/shaka-perf docs
```

Confirm no real compare/bisect invocation ran, every requested classification and resume refusal has direct test evidence, and commits remain logically granular.
