# Compare Bisect V0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `shaka-perf compare bisect [good-ref] [bad-ref]` so one run finds the first introducing commit for every monotonic visreg, perf, and accessibility regression observed at the bad ref.

**Architecture:** The compare command freezes config/tests, acquires a twin-server bisect lease, checks out candidate commits in the experiment checkout, explicitly syncs changed files into the experiment volume, refreshes only the experiment server, and runs narrowed compare pipelines. A pure scheduler owns independent target intervals and reuses typed observations persisted under `compare-bisect-results/`.

**Tech Stack:** TypeScript strict mode, Commander.js, Zod, Jest, existing compare pipeline, Git CLI, Docker Compose helpers, Overmind IPC, Yarn 4.

## Global Constraints

- The control checkout, container, volume, and process remain untouched.
- The experiment worktree must be clean; never auto-stash or discard changes.
- V0 accepts only a linear good-to-bad history with no merge commits.
- Regressions are assumed monotonic between good and bad.
- Visreg search work has priority, followed by perf, then accessibility.
- Infrastructure or stage errors never classify a commit as good or bad.
- Every exit path restores the original experiment checkout and server state.
- Preserve unrelated untracked files in this repository.
- Keep existing `shaka-perf compare` behavior backward compatible.

---

### Task 1: Config and Nested Command Contract

**Files:**
- Modify: `packages/shaka-shared/src/define-config.ts`
- Modify: `packages/shaka-perf/src/config.ts`
- Modify: `packages/shaka-perf/src/compare/cli/program.ts`
- Create: `packages/shaka-perf/src/compare/bisect/cli.ts`
- Modify: `packages/shaka-perf/src/__tests__/config.test.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`

**Interfaces:**
- Produces: `BisectConfigInput`, `BisectConfigSchema`, `BisectConfig`.
- Produces: `createBisectCommand(deps?: BisectCliDependencies): Command`.
- Preserves: bare `shaka-perf compare` action and all existing parent options.

- [ ] **Step 1: Write failing config tests**

Add tests asserting omitted config resolves to commands `[]` and `rebuildContainer: false`, and explicit values round-trip:

```ts
expect(parseAbTestsConfig(baseConfig).bisect).toEqual({
  rebuildCommands: [],
  rebuildContainer: false,
});

expect(parseAbTestsConfig({
  ...baseConfig,
  bisect: {
    rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
    rebuildContainer: true,
  },
}).bisect).toEqual({
  rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
  rebuildContainer: true,
});
```

- [ ] **Step 2: Run the config test and confirm failure**

Run:

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/__tests__/config.test.ts --runInBand
```

Expected: FAIL because `bisect` is not accepted or returned.

- [ ] **Step 3: Add shared input and Zod config shapes**

Add to `define-config.ts`:

```ts
export interface BisectConfigInput {
  rebuildCommands?: SetupCommandInput[];
  rebuildContainer?: boolean;
}

export interface AbTestsConfigInput {
  shared: SharedConfigInput;
  visreg?: VisregConfigInput;
  perf?: PerfConfigInput;
  audit?: AuditConfigInput;
  accessibility?: AccessibilityConfigInput;
  twinServers?: TwinServersConfigInput;
  bisect?: BisectConfigInput;
}
```

Add to `config.ts`:

```ts
export const BisectConfigSchema = z.object({
  rebuildCommands: z.array(SetupCommandSchema).default([]),
  rebuildContainer: z.boolean().default(false),
});

// AbTestsConfigSchema
bisect: BisectConfigSchema.optional().default({}),

export type BisectConfig = z.infer<typeof BisectConfigSchema>;
```

Return `bisect: parsed.bisect` from `parseAbTestsConfig` and add it to `AbTestsConfig`.

- [ ] **Step 4: Write failing nested-command tests**

Assert the command has a `bisect` child, accepts optional refs, and the parent action still exists:

```ts
const compare = await createCompareCommand();
expect(compare.commands.map((command) => command.name())).toContain('bisect');
expect(compare.registeredArguments).toHaveLength(0);

const bisect = compare.commands.find((command) => command.name() === 'bisect')!;
expect(bisect.registeredArguments.map((argument) => argument.name())).toEqual([
  'good-ref',
  'bad-ref',
]);
```

- [ ] **Step 5: Add the bisect command skeleton**

Create `compare/bisect/cli.ts`:

```ts
import { Command } from 'commander';

export interface BisectCliDependencies {
  run?: (goodRef: string | undefined, badRef: string | undefined, command: Command) => Promise<void>;
}

export function createBisectCommand(deps: BisectCliDependencies = {}): Command {
  return new Command('bisect')
    .description('Find the first commit for each compare regression')
    .argument('[good-ref]', 'Known-good commit; defaults to control HEAD')
    .argument('[bad-ref]', 'Known-bad commit; defaults to experiment HEAD')
    .action(async function (goodRef?: string, badRef?: string) {
      if (!deps.run) throw new Error('Bisect runner is not configured yet.');
      await deps.run(goodRef, badRef, this);
    });
}
```

Build the compare command in a local variable, add `createBisectCommand()`, then return it.

- [ ] **Step 6: Run focused tests and typechecks**

Run:

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/__tests__/config.test.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts --runInBand
yarn workspace shaka-shared run build
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shaka-shared/src/define-config.ts packages/shaka-perf/src/config.ts packages/shaka-perf/src/compare/cli/program.ts packages/shaka-perf/src/compare/bisect/cli.ts packages/shaka-perf/src/__tests__/config.test.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts
git commit -m "feat(compare): add bisect command config"
```

### Task 2: Versioned Session Types and Pure Scheduler

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/types.ts`
- Create: `packages/shaka-perf/src/compare/bisect/search.ts`
- Create: `packages/shaka-perf/src/compare/bisect/persistence.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`

**Interfaces:**
- Produces: `BisectTarget`, `TargetObservation`, `BisectSession`, `CommitRun`.
- Produces: `nextCandidate(session): CandidateWork | null`.
- Produces: `applyObservations(session, sha, observations): BisectSession`.
- Produces: `writeSessionAtomic(path, session)` and `writeSummary(path, session)`.

- [ ] **Step 1: Define tests for divergent target intervals**

Use ordered commits `['g', 'a', 'b', 'c', 'bad']` and three targets. Verify one candidate can move visreg toward `g` while perf moves toward `bad`:

```ts
const updated = applyObservations(session, 'b', new Map([
  ['visual', observation('visual', true)],
  ['tbt', observation('tbt', false)],
]));

expect(target(updated, 'visual').badIndex).toBe(2);
expect(target(updated, 'tbt').goodIndex).toBe(2);
```

Add cases for priority order, grouping all targets whose interval contains the candidate, cached-observation subtraction, adjacent-boundary completion, and invalid targets.

- [ ] **Step 2: Run scheduler tests and confirm failure**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts --runInBand
```

Expected: FAIL because scheduler modules do not exist.

- [ ] **Step 3: Implement versioned target/session types**

Use discriminated unions:

```ts
export type BisectCategory = 'visreg' | 'perf' | 'accessibility';
export type TargetStatus = 'active' | 'found' | 'invalid';

export interface TargetKey {
  id: string;
  category: BisectCategory;
  testFile: string;
  testName: string;
  viewport: string;
  subject: string;
}

export interface TargetObservation {
  targetId: string;
  commitSha: string;
  present: boolean;
  values: Record<string, string | number | boolean | null>;
  artifacts: string[];
}

export interface BisectTarget extends TargetKey {
  status: TargetStatus;
  goodIndex: number;
  badIndex: number;
  firstBadSha?: string;
  invalidReason?: string;
  observations: Record<string, TargetObservation>;
}
```

Define `BisectSession` exactly as the design spec, with `version: 1`.

- [ ] **Step 4: Implement pure scheduling**

`nextCandidate` selects the first active target by category priority and stable target ID, chooses `Math.floor((goodIndex + badIndex) / 2)`, then returns all active targets whose interval contains the SHA and lack an observation there:

```ts
export interface CandidateWork {
  sha: string;
  targetIds: string[];
  categories: BisectCategory[];
  testFiles: string[];
}
```

`applyObservations` immutably updates each target. Present moves `badIndex`; absent moves `goodIndex`. Adjacent boundaries set `status: 'found'` and `firstBadSha`.

- [ ] **Step 5: Write and run persistence tests**

Test that atomic writes leave valid JSON and summaries group first bad results:

```ts
writeSessionAtomic(sessionPath, session);
expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8'))).toMatchObject({
  version: 1,
  status: 'running',
});
expect(fs.existsSync(`${sessionPath}.tmp`)).toBe(false);
```

Implement with write-to-temp plus `fs.renameSync`.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts --runInBand
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shaka-perf/src/compare/bisect/types.ts packages/shaka-perf/src/compare/bisect/search.ts packages/shaka-perf/src/compare/bisect/persistence.ts packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts
git commit -m "feat(compare): add bisect search model"
```

### Task 3: Typed Regression Analysis

**Files:**
- Modify: `packages/shaka-perf/src/compare/stages/perf.ts`
- Modify: `packages/shaka-perf/src/compare/stages/perf/artifacts.ts`
- Modify: `packages/shaka-perf/src/compare/stages/perf/__tests__/artifacts.test.ts`
- Create: `packages/shaka-perf/src/compare/bisect/analyze.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/analyze.test.ts`

**Interfaces:**
- Produces: numeric `PerfMetric.controlValue`, `experimentValue`, `deltaValue`.
- Produces: `discoverTargets(testResults, orderedCommits, badSha): BisectTarget[]`.
- Produces: `observeTargets(testResults, targets, commitSha): TargetObservation[]`.

- [ ] **Step 1: Write failing numeric perf artifact test**

Extend the existing artifact fixture assertion:

```ts
expect(artifact.metrics?.[0]).toMatchObject({
  controlValue: 100,
  experimentValue: 120,
  deltaValue: 20,
  deltaPercent: 20,
});
```

- [ ] **Step 2: Add numeric perf fields**

Extend `PerfMetric`:

```ts
controlValue: number;
experimentValue: number;
deltaValue: number;
```

Populate them beside the existing display fields in `readPerfArtifact`.

- [ ] **Step 3: Write analyzer tests for all categories**

Construct `TestResult` fixtures containing:

- A visreg artifact with selector `[data-cy="hero-section"]` and a diff image.
- A perf metric `TBT` classified `regression`.
- Accessibility findings with two `new` nodes under one `button-name` rule.

Assert identities and values:

```ts
expect(targets.map((item) => [item.category, item.subject])).toEqual([
  ['accessibility', 'button-name'],
  ['perf', 'TBT'],
  ['visreg', '[data-cy="hero-section"]'],
]);
```

Also verify accessibility findings with the same rule ID collapse per test and viewport, while the same rule in another viewport remains separate.

- [ ] **Step 4: Implement category analyzers polymorphically**

Define an analyzer interface:

```ts
interface CategoryAnalyzer {
  category: BisectCategory;
  discover(input: AnalyzeInput): DiscoveredTarget[];
  observe(input: AnalyzeInput, targets: BisectTarget[]): TargetObservation[];
}
```

Register `visregAnalyzer`, `perfAnalyzer`, and `accessibilityAnalyzer` in an array. Shared code iterates analyzers; no metric-name or rule-name switch is allowed.

Accessibility values include violation count and total node count for control and experiment. Visual presence uses `diffImage !== null`. Perf presence uses `direction === 'regression'`.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/compare/stages/perf/__tests__/artifacts.test.ts packages/shaka-perf/src/compare/bisect/__tests__/analyze.test.ts --runInBand
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shaka-perf/src/compare/stages/perf.ts packages/shaka-perf/src/compare/stages/perf/artifacts.ts packages/shaka-perf/src/compare/stages/perf/__tests__/artifacts.test.ts packages/shaka-perf/src/compare/bisect/analyze.ts packages/shaka-perf/src/compare/bisect/__tests__/analyze.test.ts
git commit -m "feat(compare): analyze bisect regressions"
```

### Task 4: Pipeline Hooks for Frozen Tests and Candidate Artifacts

**Files:**
- Modify: `packages/shaka-perf/src/compare/compare-pipeline.ts`
- Modify: `packages/shaka-perf/src/pipeline/runner.ts`
- Modify: `packages/shaka-perf/src/pipeline/__tests__/pipeline.test.ts`
- Modify: `packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts`

**Interfaces:**
- Adds: `ComparePipelineConfig.artifactRoot?: string`.
- Adds: `RuntimeOptions.tests?: readonly AbTestDefinition[]`.
- Adds: `PipelineRunResult.testResults: readonly TestResult[]`.

- [ ] **Step 1: Write failing pipeline tests**

Add one test that passes a frozen test definition while mocking `loadTests`, then asserts the loader is not called. Add one test asserting a pipeline artifact root changes `resultsRoot`. Add one test asserting successful results expose `testResults`.

```ts
const result = await runPipeline(pipeline, {
  ...runtime,
  tests: [frozenTest],
});
expect(loadTests).not.toHaveBeenCalled();
expect(result.testResults[0].name).toBe(frozenTest.name);
```

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/pipeline/__tests__/pipeline.test.ts packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts --runInBand
```

Expected: FAIL on missing options/results.

- [ ] **Step 3: Implement frozen tests and result exposure**

In `RuntimeOptions`:

```ts
readonly tests?: readonly AbTestDefinition[] | undefined;
```

Resolve run/report tests with the override:

```ts
const frozenTests = runtime.tests ? [...runtime.tests] : null;
const runTests = runtime.reportOnly
  ? []
  : frozenTests ?? await loadTests({
      testPathPattern: runtime.testPathPattern,
      filter: runtime.filter,
      log: (message) => console.log(message),
    });
const reportTests = runtime.reportOnly
  ? frozenTests ?? await loadTests({ log: (message) => console.log(message) })
  : runTests;
```

Return `testResults: data.tests` from both report and skip-report paths. Extend `ComparePipelineConfig` and pass `artifactRoot` into `createPipeline`.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/pipeline/__tests__/pipeline.test.ts packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts --runInBand
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shaka-perf/src/compare/compare-pipeline.ts packages/shaka-perf/src/pipeline/runner.ts packages/shaka-perf/src/pipeline/__tests__/pipeline.test.ts packages/shaka-perf/src/compare/__tests__/compare-pipeline.test.ts
git commit -m "feat(compare): expose bisect pipeline results"
```

### Task 5: Git Range, Checkout, and Explicit Volume Sync

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/git.ts`
- Create: `packages/shaka-perf/src/compare/bisect/sync.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/sync.test.ts`

**Interfaces:**
- Produces: `prepareGitRange(options): PreparedGitRange`.
- Produces: `checkoutDetached(repoDir, sha): Promise<void>`.
- Produces: `restoreCheckout(repoDir, original): Promise<void>`.
- Produces: `reconcileExperimentVolume(options)` and `syncCommitDelta(options)`.

- [ ] **Step 1: Write temporary-repository Git tests**

Create a temp Git repo with five commits. Assert defaults, explicit refs, ordered SHAs, dirty rejection, control mismatch, non-ancestor rejection, and merge rejection.

```ts
const prepared = await prepareGitRange({
  experimentDir,
  controlDir,
  goodRef: undefined,
  badRef: undefined,
});
expect(prepared.goodSha).toBe(controlHead);
expect(prepared.badSha).toBe(experimentHead);
expect(prepared.orderedCommits).toEqual(commits);
```

- [ ] **Step 2: Implement safe Git helpers**

Use `exec('git', args, { cwd, silent: true })`, never interpolated shell commands. `prepareGitRange` runs:

```text
git status --porcelain --untracked-files=all
git rev-parse --verify <ref>^{commit}
git merge-base --is-ancestor <good> <bad>
git rev-list --reverse --ancestry-path <good>..<bad>
git rev-list --parents <good>..<bad>
```

Prepend good SHA to the ordered list and reject any candidate line with more than one parent. Record `{ branch: string | null, sha }` for restoration.

- [ ] **Step 3: Write sync tests covering every file operation**

Use a source checkout, fake volume, and `BuildManifest`. Transition between commits containing add, modify, rename, delete, and executable-bit changes. Assert exact contents, deletion, and mode:

```ts
expect(fs.readFileSync(path.join(volume, 'added.txt'), 'utf8')).toBe('added');
expect(fs.existsSync(path.join(volume, 'deleted.txt'))).toBe(false);
expect(fs.statSync(path.join(volume, 'script.sh')).mode & 0o111).not.toBe(0);
```

Add a reconciliation test proving non-manifest generated files survive.

- [ ] **Step 4: Implement manifest-scoped synchronization**

`reconcileExperimentVolume` copies every current manifest-owned file, deletes stale manifest-owned paths, and writes `.shaka-bisect-materialized.json` beside the experiment volume.

`syncCommitDelta` parses `git diff --name-status -z previous candidate`. For `A/M/T`, copy destination; for `D`, delete; for `R/C`, remove rename source when appropriate and copy destination. Normalize paths and reject traversal outside source/volume roots.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts packages/shaka-perf/src/compare/bisect/__tests__/sync.test.ts --runInBand
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shaka-perf/src/compare/bisect/git.ts packages/shaka-perf/src/compare/bisect/sync.ts packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts packages/shaka-perf/src/compare/bisect/__tests__/sync.test.ts
git commit -m "feat(compare): sync bisect checkouts"
```

### Task 6: Experiment-Only Twin-Server Refresh and Lease

**Files:**
- Create: `packages/shaka-perf/src/twin-servers/commands/bisect-session.ts`
- Create: `packages/shaka-perf/src/twin-servers/helpers/overmind-processes.ts`
- Modify: `packages/shaka-perf/src/twin-servers/helpers/docker.ts`
- Modify: `packages/shaka-perf/src/twin-servers/commands/servers-menu.ts`
- Modify: `packages/shaka-perf/src/twin-servers/ipc/protocol.ts`
- Modify: `packages/shaka-perf/src/twin-servers/ipc/client.ts`
- Modify: `packages/shaka-perf/src/twin-servers/ipc/dispatch.ts`
- Create: `packages/shaka-perf/src/twin-servers/__tests__/bisect-session.test.ts`
- Modify: `packages/shaka-perf/src/twin-servers/ipc/__tests__/ipc.test.ts`

**Interfaces:**
- Produces: protocol requests `bisect-begin`, `bisect-refresh`, `bisect-end`.
- Produces: `BisectRefreshResult { mode: 'commands' | 'container'; usedFallback: boolean }`.
- Produces: `MenuController.beginBisectSession(sessionId)`.
- Produces: `MenuController.refreshBisectExperiment(sessionId, options)`.
- Produces: `MenuController.endBisectSession(sessionId)`.

- [ ] **Step 1: Write process-discovery and refresh-strategy tests**

Parse a Procfile and assert only experiment-owned processes are targeted:

```ts
expect(experimentProcessNames(procfile)).toEqual([
  'experiment-rails',
  'notify-experiment-server-started',
]);
```

Test command mode, forced container mode, no-command container mode, one fallback after command failure, one fallback after readiness failure, and no control-side Docker/Overmind calls.

- [ ] **Step 2: Add experiment-only Docker helpers**

Export `buildComposeOptions` and add:

```ts
export async function recreateExperimentContainer(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName,
    'rm', '-s', '-f', 'experiment-server'], { cwd: opts.cwd, env: opts.env });
  fs.rmSync(config.volumes.experiment, { recursive: true, force: true });
  fs.mkdirSync(config.volumes.experiment, { recursive: true });
  const result = await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName,
    'up', '-d', '--force-recreate', 'experiment-server'], { cwd: opts.cwd, env: opts.env });
  if (result.code !== 0) throw new Error('Experiment container recreation failed');
}
```

Build only experiment with the existing `build(config, { target: 'experiment' })`.

- [ ] **Step 3: Implement targeted Overmind control**

Discover process names from Procfile command bodies containing `run-overmind-command experiment` or `notify-server-started experiment`. Run:

```ts
await exec('overmind', ['stop', '--socket', socketPath, ...processNames], { cwd: config.projectDir });
await exec('overmind', ['restart', '--socket', socketPath, ...processNames], { cwd: config.projectDir });
```

Poll only `config.ports.experiment` with `probeHttpEndpoint` until ready and settled.

- [ ] **Step 4: Implement lease state and refresh fallback**

`BisectSessionController` owns `activeSessionId`. Begin rejects another ID, refresh/end require the owner ID, and auto-sync checks `activeSessionId !== null` before copying.

Refresh returns:

```ts
export interface BisectRefreshResult {
  mode: 'commands' | 'container';
  usedFallback: boolean;
}
```

Command mode runs commands with `runCmd(config, 'experiment', command)`, targeted restart, and health check. Catch command/startup errors and call the container path exactly once. Container path builds experiment, recreates experiment only, runs each setup command through `runCmd`, restarts experiment processes, and health-checks.

- [ ] **Step 5: Extend IPC with typed result data**

Add request variants carrying `sessionId`, rebuild commands, and mode. Checkout
and volume synchronization stay in the compare orchestrator; the active lease
prevents menu auto-sync or competing lifecycle work while they run. Extend
`ProxyResponse` with optional `data`. Add a dedicated client:

```ts
export async function requireBisectProxy<T>(options: TryProxyOptions): Promise<T> {
  const outcome = await tryProxy(options);
  if (!outcome.proxied) throw new Error('compare bisect requires a running shaka-perf servers session');
  if (outcome.code !== 0) throw new Error(outcome.error ?? `Twin-server action exited ${outcome.code}`);
  return outcome.data as T;
}
```

Bump `PROTOCOL_VERSION` because request/response shapes change.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/twin-servers/__tests__/bisect-session.test.ts packages/shaka-perf/src/twin-servers/ipc/__tests__/ipc.test.ts --runInBand
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shaka-perf/src/twin-servers/commands/bisect-session.ts packages/shaka-perf/src/twin-servers/helpers/overmind-processes.ts packages/shaka-perf/src/twin-servers/helpers/docker.ts packages/shaka-perf/src/twin-servers/commands/servers-menu.ts packages/shaka-perf/src/twin-servers/ipc/protocol.ts packages/shaka-perf/src/twin-servers/ipc/client.ts packages/shaka-perf/src/twin-servers/ipc/dispatch.ts packages/shaka-perf/src/twin-servers/__tests__/bisect-session.test.ts packages/shaka-perf/src/twin-servers/ipc/__tests__/ipc.test.ts
git commit -m "feat(servers): refresh bisect experiment"
```

### Task 7: Bisect Session Orchestrator and CLI Integration

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/session.ts`
- Create: `packages/shaka-perf/src/compare/bisect/run-candidate.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/cli.ts`
- Modify: `packages/shaka-perf/src/compare/cli/program.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `runBisect(options: RunBisectOptions): Promise<BisectSession>`.
- Produces: `runCandidate(options): Promise<CandidateResult>`.
- Wires: `createBisectCommand({ run })` to parsed compare/twin-server config.

- [ ] **Step 1: Write orchestration tests with injected boundaries**

Inject Git, refresh, compare, clock, and persistence functions. Verify:

- Bad endpoint discovers targets.
- Good endpoint invalidates present targets.
- Divergent files/categories produce narrowed candidate requests.
- Cached observations skip candidate reruns.
- Successful completion restores original checkout before lease end.
- Compare error aborts without moving boundaries.
- Refresh fallback metadata is persisted.
- Cancellation/error still restores and releases.

Use an event array to assert order:

```ts
expect(events.slice(-4)).toEqual([
  'checkout:original',
  'sync:original',
  'refresh:original',
  'lease:end',
]);
```

- [ ] **Step 2: Implement candidate execution**

`runCandidate`:

1. Calculates the delta from the currently materialized SHA.
2. Checks out the candidate detached and explicitly synchronizes that delta to
   the experiment volume while the twin-server lease pauses auto-sync.
3. Calls the twin-server `bisect-refresh` request to rebuild/restart only the
   experiment side.
4. Creates a compare pipeline with `artifactRoot: path.join('compare-bisect-results', 'commits', sha)`.
5. Passes frozen tests filtered to `CandidateWork.testFiles`.
6. Passes only `CandidateWork.categories`.
7. Runs the pipeline and rejects any outcome with `kind === 'error'` or missing requested target observation.
8. Returns typed observations from `analyze.ts` and refresh metadata.

- [ ] **Step 3: Implement session state machine and cleanup**

Write the session immediately with `status: 'running'`, then after every checkout, refresh, compare, and boundary update. Install signal handlers that set a cancellation flag; perform cleanup in one `finally` block and then rethrow/exit.

The main loop is:

```ts
while (true) {
  const work = nextCandidate(session);
  if (!work) break;
  const result = await runCandidate({ ...context, work });
  session = applyObservations(session, work.sha, result.observations);
  writeSessionAtomic(sessionPath, session);
}
```

Measure bad before target creation and good after target discovery. Mark final status complete and write summary only after restoration succeeds.

- [ ] **Step 4: Wire real CLI dependencies**

Factor existing compare config-to-pipeline input into a shared helper so bare compare and bisect cannot drift. `compare bisect` resolves inherited parent options with `this.optsWithGlobals()`/parent options, loads config once, loads tests once, resolves twin-server config, and calls `runBisect`.

Add `compare-bisect-results/` to `.gitignore`.

- [ ] **Step 5: Run focused tests and typechecks**

```bash
yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts --runInBand
yarn workspace shaka-shared run build
yarn workspace shaka-perf run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/run-candidate.ts packages/shaka-perf/src/compare/bisect/cli.ts packages/shaka-perf/src/compare/cli/program.ts packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts
git commit -m "feat(compare): orchestrate bisect sessions"
```

### Task 8: Demo Configuration, Documentation, and Acceptance

**Files:**
- Modify: `demo-ecommerce/abtests.config.ts`
- Modify: `packages/shaka-perf/README.md`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/seed-history.test.ts`
- Modify: `docs/superpowers/specs/2026-07-12-compare-bisect-design.md`

**Interfaces:**
- Documents: command, defaults, config, output, preconditions, and restoration.
- Verifies: seeded commit targets from `codex/git-bisect-demo-history`.

- [ ] **Step 1: Add demo rebuild commands**

Configure:

```ts
bisect: {
  rebuildCommands: [
    {
      description: 'Install JavaScript dependencies',
      command: 'yarn install --immutable',
    },
    {
      description: 'Precompile application assets',
      command: 'SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile',
    },
  ],
},
```

- [ ] **Step 2: Add a deterministic scheduler acceptance test using seed metadata**

Build observations matching the documented history and assert first bad SHAs for:

```ts
expect(summary.targets).toEqual(expect.arrayContaining([
  expect.objectContaining({ category: 'visreg', firstBadSha: 'aa1b86a' }),
  expect.objectContaining({ category: 'perf', firstBadSha: '5d38dcf' }),
  expect.objectContaining({ category: 'accessibility', firstBadSha: '38e7882' }),
]));
```

Resolve full SHAs in the fixture so assertions do not depend on abbreviations.

- [ ] **Step 3: Document user workflow**

Add a README section covering:

```bash
shaka-perf servers
shaka-perf compare bisect
shaka-perf compare bisect <good-ref> <bad-ref> --categories visreg,perf
```

Document clean-worktree and live-menu requirements, fixed control semantics, config modes, fallback, `compare-bisect-results/summary.json`, and guaranteed restoration.

Change the spec status to `Implemented` only after acceptance succeeds.

- [ ] **Step 4: Run package verification**

```bash
yarn workspace demo-ecommerce typecheck
yarn workspace shaka-shared run build
yarn workspace shaka-perf run typecheck
yarn workspace shaka-perf test --runInBand
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Run live seeded-history acceptance**

With twin servers running and the control checkout at `38dae68`, run from the feature-built CLI:

```bash
yarn shaka-perf compare bisect 38dae68 codex/git-bisect-demo-history
```

Verify `compare-bisect-results/summary.json` contains:

- Homepage visual targets first bad at `aa1b86a`.
- Homepage perf targets first bad at `5d38dcf`.
- Homepage `button-name` accessibility target first bad at `38e7882`.
- Product-detail visual and perf targets first bad at `993637a`.
- AB-test file, test, viewport, and category-specific values for every target.
- Original experiment branch/SHA restored.
- Control SHA unchanged.

- [ ] **Step 6: Commit**

```bash
git add demo-ecommerce/abtests.config.ts packages/shaka-perf/README.md packages/shaka-perf/src/compare/bisect/__tests__/seed-history.test.ts docs/superpowers/specs/2026-07-12-compare-bisect-design.md
git commit -m "docs(compare): document bisect v0"
```

## Final Verification

- [ ] Run `git status --short --branch` and confirm only unrelated pre-existing untracked files remain.
- [ ] Inspect `git diff main...HEAD --stat` and ensure changes are limited to compare bisect, required pipeline/twin-server support, demo config, tests, and docs.
- [ ] Run `git diff --check main...HEAD`.
- [ ] Run `yarn workspace shaka-shared run build`.
- [ ] Run `yarn workspace shaka-perf run typecheck`.
- [ ] Run `yarn workspace shaka-perf test --runInBand`.
- [ ] Run `yarn workspace demo-ecommerce typecheck`.
- [ ] Inspect live `compare-bisect-results/summary.json` against every seeded regression requirement.
- [ ] Confirm control and experiment SHAs after acceptance match their pre-run values.
