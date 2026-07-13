# Compare Bisect Merge and Resume Design

## Goal

Extend `shaka-perf compare bisect` so the primary search follows first-parent history through merge commits, reports merge introductions before optional source investigation, and can safely resume the latest version-2 saved session without repeating completed comparisons.

The implementation must not run a real bisect pipeline during development or verification.

## Compatibility Boundary

Resumability begins with session schema version 2. Existing version-1 files remain readable as historical JSON, but `--resume` rejects them with a specific explanation that they predate resumable state. Version 1 lacks repository identity, compatibility fingerprints, phase state, merge queues, and attempt history; inferring those values could reuse invalid evidence.

Only `compare-bisect-results/session.json` is considered. There is no run picker and no search through older directories: `--resume` always addresses the latest saved run in the configured results directory.

## CLI Contract

Add two flags:

```text
--resume               Continue the latest compatible saved bisect session
--investigate-merges   After primary results, inspect eligible bad merge sources
```

Fresh invocations continue to accept optional `good-ref` and `bad-ref`. `--resume` rejects positional refs because the saved immutable SHAs are authoritative. It also rejects fresh-run-only flags whose meaning cannot be safely applied to existing evidence, including `--reuse-current-results`, `--dry-run`, and `--validate-good-ref`.

The current configuration, frozen tests, effective URL/filter overrides, categories, and rebuild strategy are still loaded on resume so their fingerprints can be compared with the saved session. Category order is normalized before hashing so an equivalent set remains compatible.

Resume behavior is:

- An incomplete primary phase resumes automatically.
- A complete primary phase with uninvestigated merges does no further work unless `--investigate-merges` is supplied.
- An interrupted merge investigation continues only with `--resume --investigate-merges`.
- A fully complete compatible session prints the saved result without comparing commits again.

Every primary result that lands on a merge and has not been investigated prints this exact follow-up command:

```text
shaka-perf compare bisect --resume --investigate-merges
```

## Git Topology

### Primary range

The primary range is built with first-parent traversal:

```bash
git rev-list --first-parent --reverse <good>..<bad>
```

`good` must still be an ancestor of `bad`, and control must still equal the resolved good SHA. Merge commits remain one atomic candidate in the ordered range. The range loader records every primary commit's subject and full parent list. It no longer rejects merges.

Primary target scheduling, category grouping, exact AB-test selection, observation caching, and independent target intervals remain unchanged.

### Child range

For each eligible first-bad merge:

1. Require exactly two parents.
2. Compute `merge-base(first-parent, second-parent)`.
3. Build a first-parent range from that merge base to the second parent.
4. Validate the second parent for only the targets introduced at the mainline merge.
5. Mark targets absent at the second parent as `merge-introduced`.
6. Search reproducing targets with the shared midpoint engine.

Child searches never enqueue more investigations. A merge selected inside a child range is an atomic source result classified as `nested-merge`. A normal child first-bad commit is `source-found`.

An octopus merge is retained as the primary first-bad commit and classified `octopus-unsupported` without measuring any parent branch.

## Version-2 State Model

The persisted state is rooted at a version-2 `BisectSession`:

```ts
interface BisectSession {
  version: 2;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  mode: 'primary' | 'merge-investigation' | 'complete';
  identity: BisectRepositoryIdentity;
  compatibility: BisectCompatibility;
  originalExperiment: CheckoutState;
  control: CheckoutState;
  rebuildStrategy: PersistedRebuildStrategy;
  primary: BisectSearchPhase;
  mergeQueue: string[];
  mergeInvestigations: Record<string, MergeInvestigation>;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
}
```

### Repository identity and compatibility

`BisectRepositoryIdentity` stores canonical control and experiment repository roots, their canonical Git common directories, and normalized `origin` URLs when present. Paths are intentionally part of identity so moving the saved run to another checkout is rejected.

`BisectCompatibility` stores SHA-256 fingerprints for:

- the config file contents and effective CLI overrides;
- the normalized selected-category set;
- frozen test file/name pairs admitted by CLI filters;
- the rebuild strategy;
- the resolved good and bad SHAs.

It also stores the human-readable effective values used to produce actionable mismatch errors instead of only reporting two opaque hashes.

On resume, validation happens before the twin-server lease is acquired. It requires:

- a valid version-2 schema;
- matching repository identity and canonical paths;
- clean control and experiment checkouts, allowing only the results directory;
- control at the saved good SHA;
- experiment at the saved original branch and SHA;
- unchanged config, categories, frozen tests, URLs/filters, range, and rebuild strategy.

Each refusal identifies the mismatched field and explains how to start a fresh run.

### Search phases

Primary and child searches share one data structure:

```ts
interface BisectSearchPhase {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  goodSha: string;
  badSha: string;
  orderedCommits: string[];
  commitSubjects: Record<string, string>;
  commitParents: Record<string, string[]>;
  targets: BisectTarget[];
  attempts: CommitAttempt[];
  startedAt?: string;
  finishedAt?: string;
}
```

The shared phase runner accepts a phase plus mandatory callbacks for measuring a candidate and handling phase completion. It never switches on a phase name. Primary orchestration and merge-investigation orchestration construct phase data and call the same runner. This keeps variant behavior outside shared scheduling logic and follows the repository's polymorphic extension rule.

Targets in a child phase are copies of the relevant primary targets with child-local bounds and observations. The primary target remains the authoritative mainline result.

### Comparison attempts

Every checkout/rebuild/compare try creates a `CommitAttempt`:

```ts
interface CommitAttempt {
  id: string;
  sha: string;
  status: 'running' | 'complete' | 'incomplete';
  requestedCategories: BisectCategory[];
  requestedTests: BisectTestSelection[];
  refreshMode: 'commands' | 'container';
  usedFallback: boolean;
  startedAt: string;
  finishedAt?: string;
  compareResultsPath?: string;
  error?: string;
}
```

The session checkpoints the running attempt before checkout. A successful comparison atomically checkpoints the completed attempt, produced observations, and updated target bounds together. A rebuild, readiness, comparison, interruption, or persistence failure records the attempt as incomplete and does not move any target boundary.

On load, a leftover `running` attempt from a crashed process is normalized to incomplete. Because it has no committed observations, resume retries it. Completed observations remain cached, so scheduling never repeats a completed target/SHA comparison.

## Merge Investigation State

Each primary first-bad merge has one record:

```ts
type MergeInvestigationStatus =
  | 'merge-uninvestigated'
  | 'running'
  | 'complete'
  | 'octopus-unsupported'
  | 'failed';

interface MergeInvestigation {
  mergeSha: string;
  parents: string[];
  status: MergeInvestigationStatus;
  targetIds: string[];
  phase?: BisectSearchPhase;
  targetResults: Record<string, MergeTargetResult>;
}

type MergeTargetResult =
  | { kind: 'merge-uninvestigated' }
  | { kind: 'merge-introduced' }
  | { kind: 'source-found'; sourceSha: string }
  | { kind: 'nested-merge'; sourceSha: string }
  | { kind: 'octopus-unsupported' };
```

Merge queue order follows the primary range, then stable target order within each merge. All primary targets and categories finish before the queue is created. Investigations run sequentially so the experiment checkout and volume have one owner.

## Lifecycle and Checkpointing

### Fresh run

1. Resolve and fingerprint repositories, config, categories, tests, and range.
2. Create and atomically write the version-2 session.
3. Acquire the twin-server lease.
4. Run bad-ref discovery and optional good-ref validation as today.
5. Run the primary phase through first-parent commits.
6. Mark merge targets `merge-uninvestigated`, construct the queue, and atomically checkpoint the primary-complete transition.
7. Generate the initial JSON summary, decision log, terminal preview, and HTML report.
8. If `--investigate-merges` is enabled, begin child investigations only after step 7 completes.
9. Restore the original checkout, release the lease, and write terminal state.

### Resume

1. Read and validate `session.json` and the persisted report input.
2. Validate compatibility, repository identity, checkout state, and cleanliness.
3. Determine the next incomplete primary or child unit without mutating state.
4. Acquire the twin-server lease only when comparison work remains.
5. Set the in-memory materialized SHA to unknown.
6. Check out the required candidate.
7. Perform full manifest reconciliation, then rebuild/restart and wait for readiness.
8. After that succeeds, use normal Git deltas from the now-known materialized SHA.
9. Continue checkpointing attempts and phase transitions.
10. Restore the original checkout and release the lease.

The existing materializer already uses full manifest reconciliation when `previousSha` is null. Resume deliberately starts with null rather than trusting the last persisted candidate. Tests assert validation occurs before lease acquisition and full reconciliation occurs before the first resumed refresh.

## Persisted Report Input

The HTML report currently depends on in-memory bad-ref `TestResult[]`. Resume must update the report without rerunning bad-ref discovery, so the initial bad-ref results are atomically written to:

```text
compare-bisect-results/bad-ref-tests.json
```

The session records its filename and SHA-256 digest. Resume validates both before doing work. The report is regenerated from this saved input plus the current session after every primary/merge phase transition. A missing or changed report input makes the session incompatible.

## Reporting

Every target report record adds:

- `mainlineFirstBadSha`;
- `mainlineIsMerge`;
- `mergeInvestigationStatus`;
- `mergeSourceSha` when found;
- `mergeResult`: `merge-uninvestigated`, `merge-introduced`, `source-found`, `nested-merge`, or `octopus-unsupported`.

The mainline commit tree stays primary-first. Merge nodes receive a merge badge and investigation state. Target details show the mainline merge and source outcome together, while retaining the existing category, AB test, viewport, metric/rule identity, bad-ref values, and artifact-backed test card.

The Zod payload schema, report model, React report components, JSON summary, session JSON, decision log, terminal summary, README, CLI help, and original compare-bisect design documentation are updated together.

The initial primary report is a durable output even when later source investigation fails. Subsequent report writes are atomic and only replace it after a complete render succeeds.

## Error Handling

- Git topology or identity errors occur before checkout mutation.
- A two-parent merge with an invalid merge-base or child range records a failed investigation without changing the primary result.
- Octopus merges are successful primary results with unsupported child status, not session failures.
- Incomplete attempts never count as good or bad evidence.
- Resume validation errors do not acquire the lease or alter the checkout.
- Cleanup failures retain their existing aggregation and durable failed-state behavior.

## Test Strategy

Focused red-green tests cover:

- first-parent range ordering and merge parent metadata;
- atomic primary handling of merge commits;
- version-2 schema parsing and clear v1 rejection;
- atomic session/report-input persistence;
- fingerprints and every resume incompatibility class;
- incomplete attempt retry and completed observation reuse;
- validation-before-lease ordering;
- first resumed candidate full reconciliation, followed by normal deltas;
- primary-complete report generation before child work;
- two-parent source reproduction and child first-bad results;
- per-target `merge-introduced` classification;
- nested merge and octopus classifications;
- no investigation deeper than one level;
- CLI flag combinations and exact follow-up command;
- JSON, terminal, report model, Zod schema, React rendering, and browser acceptance.

Final verification runs focused tests during development, the complete relevant bisect/report suite, `yarn build`, and `git diff --check`. No command invokes the real compare bisect pipeline.

## Commit Boundaries

Implementation is split into small logical commits:

1. First-parent Git topology and merge metadata.
2. Version-2 schemas, fingerprints, and atomic resume persistence.
3. Generic phase runner and resumable attempt/checkpoint behavior.
4. Resume repository validation and first-candidate reconciliation.
5. Merge queue and one-level child investigations.
6. CLI, terminal, JSON, HTML report, and documentation.
