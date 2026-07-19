# Unversioned Bisect Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V1/V2 compatibility model with one strict, unversioned compare-bisect session contract.

**Architecture:** `BisectSession` is the only persisted session type and stores search state once, under `primary`. Runtime-only dry-run presentation stays outside the persisted contract, while current-run checkpoint metadata remains explicit state used by the search engine. State parsing is strict and performs crash normalization only; it does not migrate or materialize legacy files.

**Tech Stack:** TypeScript, Zod, Jest, Yarn workspaces.

## Global Constraints

- Persisted `session.json` has no `version` field.
- There is no `BisectSessionV2` type, V1-specific error, migration, or legacy-field fallback.
- Canonical range, commit, and target state lives under `session.primary`.
- Existing versioned session files are intentionally invalid.
- Preserve unrelated working-tree changes.

---

### Task 1: Define and validate the canonical persisted contract

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/state.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/types.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/state.ts`

**Interfaces:**
- Produces: `BisectSession`, the sole persisted session interface.
- Produces: `parseBisectSession(value: unknown): BisectSession`.
- Produces: `readBisectSession(filePath: string): BisectSession`.

- [ ] **Step 1: Change the state fixture and parsing assertions first**

Remove `version: 2` from the valid fixture, assert that the unversioned object parses,
and replace the V1-specific assertion with strict rejection of any version field:

```ts
it('strictly parses unversioned sessions and normalizes crashed attempts', () => {
  const parsed = parseBisectSession(session());
  expect(parsed.primary.attempts).toMatchObject([{
    id: 'attempt-1',
    status: 'incomplete',
    error: 'process stopped before the attempt completed',
  }]);
});

it.each([1, 2])('rejects versioned session files (%s)', (version) => {
  expect(() => parseBisectSession({ ...session(), version })).toThrow(/unrecognized/i);
});
```

- [ ] **Step 2: Run the focused state test and verify RED**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/state.test.ts --runInBand
```

Expected: FAIL because `version` is required by the current schema/type and versioned
sessions are still accepted or specially handled.

- [ ] **Step 3: Consolidate the types and strict schema**

Delete `BisectSessionV2`. Replace the old mixed `BisectSession` declaration with the
current resumable fields, omitting `version` and legacy top-level range/search copies:

```ts
export interface BisectSession {
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  mode: 'primary' | 'merge-investigation' | 'complete';
  identity: BisectRepositoryIdentity;
  compatibility: BisectCompatibility;
  originalExperiment: { sha: string; branch: string | null };
  control: { sha: string; branch: string | null };
  rebuildStrategy: PersistedRebuildStrategy;
  reportInput: { filename: string; sha256: string };
  primary: BisectSearchPhase;
  mergeQueue: string[];
  mergeInvestigations: Record<string, MergeInvestigation>;
  commitRuns: Record<string, CommitRun>;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
}
```

Remove `version` and all legacy optional fields from `sessionSchema`, delete the
V1-specific conditional and `materializeBisectSession()`, and change every state API
signature from `BisectSessionV2` to `BisectSession`.

- [ ] **Step 4: Run the focused state test and TypeScript compiler**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/state.test.ts --runInBand
yarn workspace shaka-perf typecheck
```

Expected: state test PASS; typecheck FAIL only at consumers that still use
`BisectSessionV2`, `version`, or legacy top-level session fields, establishing the
remaining refactor surface.

---

### Task 2: Move engine, persistence, and reports to the canonical shape

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/persistence.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/report-only.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/report-model.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/report-only.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts`

**Interfaces:**
- Consumes: the unversioned `BisectSession` and strict state parser from Task 1.
- Produces: reports and summaries derived from `session.primary`.
- Produces: resume execution that accepts only the canonical persisted shape.

- [ ] **Step 1: Update report and persistence tests first**

Build fixtures without `version` or duplicate top-level search fields. Add assertions
that summary/report data comes from `primary`:

```ts
expect(model.goodSha).toBe(saved.primary.goodSha);
expect(model.badSha).toBe(saved.primary.badSha);
expect(model.targets.map(({ id }) => id)).toEqual(
  saved.primary.targets.map(({ id }) => id),
);
```

For report-only, keep the malformed-session case but make `{ version: 2 }` invalid
because it lacks the canonical unversioned contract, not because a version literal
is expected.

- [ ] **Step 2: Run the report/persistence tests and verify RED**

Run:

```bash
yarn workspace shaka-perf jest \
  src/compare/bisect/__tests__/persistence.test.ts \
  src/compare/bisect/__tests__/report-model.test.ts \
  src/compare/bisect/__tests__/report-only.test.ts \
  --runInBand
```

Expected: FAIL where production code still reads `session.goodSha`,
`session.targets`, or materializes a versioned session.

- [ ] **Step 3: Refactor production consumers**

Make `report-only.ts` return `parseBisectSession(readJson(filePath))` directly.
In `report-model.ts` bind the canonical phase once and use it consistently:

```ts
const { primary } = session;
const targets = primary.targets.map(/* existing target projection */);
const commits = primary.orderedCommits.map(/* existing commit projection */);

return {
  status: session.status,
  goodSha: primary.goodSha,
  badSha: primary.badSha,
  // existing report fields
};
```

In `session.ts`, replace `BisectSessionV2` signatures with `BisectSession`, remove
`version: 2`, remove the version guard around bad-ref persistence, delete
`sessionViewFromPersisted()`, and update canonical targets only through `primary`.
Keep `commitRuns` as a required current checkpoint map because it is consumed by
search recovery and report measured-state logic; it is not a legacy duplicate.

Change `writeSummary()` so range, subjects, and targets come from `session.primary`
and remove the `version`, `dryRun`, `validateGoodRef`, and `nextAction` persistence
fields. Pass dry-run presentation data directly to console/decision-log handling
rather than adding it to `BisectSession`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
yarn workspace shaka-perf jest \
  src/compare/bisect/__tests__/state.test.ts \
  src/compare/bisect/__tests__/persistence.test.ts \
  src/compare/bisect/__tests__/report-model.test.ts \
  src/compare/bisect/__tests__/report-only.test.ts \
  src/compare/bisect/__tests__/session.test.ts \
  --runInBand
```

Expected: PASS with no versioned session fixtures or compatibility materialization.

---

### Task 3: Remove remaining compatibility fixtures and verify the package

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/merge-investigation.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/search.ts`

**Interfaces:**
- Consumes: the canonical `BisectSession` contract from Tasks 1 and 2.
- Produces: no compare-bisect reference to session V1/V2 naming or persistence.

- [ ] **Step 1: Separate scheduler input from persisted sessions**

Use the scheduler's flat `BisectSearchInput` for `search.test.ts` fixtures rather
than typing those fixtures as persisted `BisectSession` objects:

```ts
function session(targets: BisectTarget[]): BisectSearchInput {
  return {
    orderedCommits,
    targets,
    commitRuns: {},
  };
}

function target(value: BisectSearchInput, id: string): BisectTarget {
  return value.targets.find((item) => item.id === id)!;
}
```

Update CLI and merge-investigation fixtures that represent persisted sessions to
the canonical shape. Leave unrelated `version` fields such as Docker/build-manifest
protocol versions unchanged.

- [ ] **Step 2: Prove compatibility code is gone**

Run:

```bash
rg -n "BisectSessionV[0-9]|session\.version|version: z\.literal\([12]\)|predates resumable state|materializeBisectSession" \
  packages/shaka-perf/src/compare/bisect
```

Expected: no matches.

- [ ] **Step 3: Run the compare-bisect suite**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run package and repository validation**

Run:

```bash
yarn workspace shaka-perf typecheck
git diff --check
.agents/bin/validate
```

Expected: all commands exit 0. If the full repository validation exposes an
unrelated environmental failure, record the exact command and error without hiding
it or broadening this refactor.
