# Adding a Stage

A walkthrough for adding a new stage to an existing pipeline (or a new
pipeline that introduces one). Covers the `Stage<M>` contract, file
layout, how parallelism actually works, and what to do with long
synchronous JS tasks.

If you're messing with core componets like Pipeline Stage Runner Report
 etc. read `.claude/skills/review-architecture/SKILL.md` — this doc focuses
on plumbing; that one is about API shape.

## What a stage is

A pipeline is an ordered list of stages. The runner expands every
applicable test × viewport into a `TestUnit`, then runs each stage
across every unit. Per-unit work runs on a unit-keyed promise chain:
unit K's stage 2 starts only after unit K's stage 1 finishes, but unit
K+1's stage 1 runs in parallel with unit K's stage 2 (capped by the
pool's `parallelism`).

Each stage owns its own:
- Run-time logic (one `run(ctx, pool)` per test+viewport).
- `applies(...)` gate based on prior outcomes.
- React-rendered artifact view in the report.
- Optional machine-readable summary for `report.json`.

## File layout

Put a new stage under `src/<pipeline>/stages/<stage_name>/`:

```
stages/
  build_annotated_timeline/
    stage.ts      # The Stage<M> class (lightweight)
    engine.ts     # Heavy logic, lazy-imported by stage.run()
    report.tsx    # renderArtifacts implementation
    index.ts      # Barrel
```

Why split `stage.ts` from `engine.ts`? `stage.ts` is imported eagerly by
the pipeline definition file; `engine.ts` is loaded by the runner the
first time the stage actually runs. Dynamic-imported engine code keeps
the report-shell build (which calls `renderArtifacts` only) from
bundling native deps like `sharp`, `playwright`, and `lighthouse`.

## The `Stage<M>` contract

```ts
import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { Viewport } from '../../../config';
import type { Outcome } from '../../../pipeline/outcome';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import {
  emptyMachineReadableSummary,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import { MyStageArtifactView } from './report';

export interface MyResult { /* what run() returns */ }

export class MyStage implements Stage<MyResult> {
  readonly category = 'audit';          // shaka-shared TestType
  readonly name: StageName = 'my_stage';
  readonly description = 'One-liner shown in CLI help and the report.';

  constructor(private readonly config: MyStageConfig) {}

  applies(_test: AbTestDefinition, _viewport: Viewport, priorOutcomes: ReadonlyMap<StageName, Outcome>): boolean {
    return priorOutcomes.get('audit')?.kind === 'ok';
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<MyResult> {
    const runImpl = './engine';
    const { runMyStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runMyStage(ctx, pool, this.config);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<MyResult>[]) {
    return createElement(MyStageArtifactView, { measurements });
  }

  machineReadableSummary = emptyMachineReadableSummary;
}
```

Field-by-field:

- **`name`** — unique within the pipeline. Used as the outcome JSON
  filename (`<testAndViewportId>/<name>.json`), the report shell's
  `<section data-stage="<name>">`, the CLI's `--skip-stages` value, and
  the key in `chipsForAllTests`'s `results` map. Stage names with
  spaces or non-`[a-zA-Z0-9_-]+` characters will fight you later.

- **`category`** — one of the `TestType`s declared in `shaka-shared`
  (`'visreg' | 'perf' | 'audit'`). The runner uses it to filter
  viewports per category and to honour `--categories`.

- **`description`** — one-liner shown in `>>> <name> · <description>`
  banner and the report.

- **`applies(test, viewport, priorOutcomes)`** — called once per unit
  before `run`. Returning `false` produces a `skipped` outcome with a
  framework-supplied reason. Use this for cross-stage dependencies:
  ```ts
  applies(_test, _viewport, priorOutcomes) {
    return priorOutcomes.get('audit')?.kind === 'ok';
  }
  ```
  Per-test category opt-outs (`testTypes: [...]`) and viewport filters
  are handled by the runner before `applies` even fires.

- **`run(ctx, pool)`** — the worker. Returns `MyResult` on success;
  throw to mark the unit failed. The runner persists
  `{ kind: 'ok' | 'error', stage, measurement, error, logs }` to
  `<resultsRoot>/<testAndViewportId>/<name>.json`. Console.log/warn/error
  inside `run` are captured into `outcome.logs` and embedded in the
  report's logs panel.

- **`renderArtifacts(measurements)`** — runs inside the report-shell.
  See [Report-side considerations](#report-side-considerations).

- **`machineReadableSummary(measurement, ctx)`** — returns the JSON
  shape persisted into `report.json`. Default to
  `emptyMachineReadableSummary` until a downstream reader needs
  something specific.

There's a second pattern worth knowing about: a single class
parameterised by `name`/`config` that the pipeline instantiates
multiple times. `PerfEngineStage<M>` in
`src/compare/stages/perf/stage.ts` is the canonical example — same
engine runs warm-up, statistical, and low-noise passes with different
configs. Reach for it when several stages share a non-trivial engine;
prefer one class per stage otherwise.

## Wiring into a pipeline

In `src/<pipeline>/pipeline.ts`:

```ts
return createPipeline({
  name: 'audit',
  description: '...',
  pipelineConfig: input,    // serialised into the report; see below
  report: pipelineReport,
}, (pipeline) => {
  const workerPool = pipeline.registerWorkerPool(input.parallelism);
  pipeline.runStage(workerPool, new AuditStage({ ... }));
  pipeline.runStage(workerPool, new MyStage({ ... }));
  pipeline.waitForAllTasksFinishAndDispose(workerPool);

  pipeline.buildChips<{ audit: AuditResult; my_stage: MyResult }>({
    chipsForAllTests(perTest) {
      const out = new Map<AbTestDefinition, readonly ChipDescriptor[]>();
      // ...derive chips from per-test stage results...
      return out;
    },
  });
});
```

And update the pipeline metadata so the CLI and report know the stage
exists:

```ts
export const auditPipelineMetadata = {
  description: '...',
  categories: ['audit'],
  stages: ['audit', 'my_stage'],
} as const;
```

If this is a brand-new pipeline (not just a new stage in an existing
one), wire it into `src/pipeline/pipeline-artifacts.ts`'s switch
statement. That switch is the **only** allowed name-keyed dispatcher in
shared code — it deserialises a pipeline name from a persisted report
back into an instance. Anywhere else, prefer polymorphism.

## Worker pools and parallelism

The `WorkerPool` is the **only** sanctioned throttle for parallel work
in shaka-perf. Submit every CPU-significant or wall-clock-significant
task through it.

### What the pool does

- Caps in-flight tasks at `parallelism`. Excess submissions queue in
  **FIFO order across the whole queue** — no priority, no depth-first
  bias toward later stages.
- Tracks per-task progress and exposes it in the `sticky-status` panel
  and per-test report logs.
- Retries failed tasks on the same worker up to `retries` times. Each
  retried failure logs to the stage's BufferedStageLogger with a red
  `task failed (worker N attempt X/Y)` line.
- Cascades cancellation by `key`: when one submission exhausts its
  retries, every queued and in-flight submission sharing that key
  cancels with the same poison reason. Group related sub-tasks under
  one key (typically `${ctx.testAndViewportId}:${stage.name}`).

### What the pool does NOT do

**It does not move work off the main thread.** Submitted task bodies
run on the same JS thread as everything else; only the native-bound
async calls they `await` (`sharp.toBuffer`, `child_process.spawn`,
`fs.promises.readFile`) actually release the loop. The pool gates how
many tasks run concurrently — not how much CPU each one uses.

This distinction matters for [long synchronous JS tasks](#long-synchronous-js-tasks).

### How to submit

```ts
await pool.submit(
  async () => doWork(),
  { key: `${ctx.testAndViewportId}:my_stage` },
);
```

For batched fan-out (e.g. per-frame compositing in
`build_annotated_timeline`), submit each item separately and
`Promise.all` the returned promises. The pool's parallelism is the cap
across **all** in-flight items from **all** concurrent units — exactly
what you want.

Cheap synchronous bookkeeping doesn't need a slot. Reach for
`pool.submit` when:
- The work takes more than ~50ms of wall-clock.
- It calls a native binding (sharp, libvips, sqlite).
- It spawns a child process.
- It does sizable disk or network I/O.

### Multiple pools

A pipeline can register more than one pool with different parallelism
settings. The compare pipeline uses a parallel pool for visreg + perf
warm-up + statistical perf, then waits, then a single-threaded pool
for the low-noise final pass. See `src/compare/compare-pipeline.ts`.

Always call `pipeline.waitForAllTasksFinishAndDispose(pool)` after the
last stage that uses a pool, before registering the next one.

### Naming sub-task keys

Use one key per `(testAndViewportId, stage)` pair when you submit
multiple sub-tasks for the same stage on the same unit. If you accept
that one failed sub-task should cancel the rest of that unit's stage
work, this is what you want. If sub-tasks should fail independently,
give each its own unique key — but then you also lose retry-budget
shared accounting.

## Long synchronous JS tasks

Pool routing serialises work and surfaces it in metrics, but it
**doesn't reduce per-task main-thread blockage**. A single 5-second
synchronous `JSON.parse` still blocks the event loop for 5 seconds
whether it's inside `pool.submit` or not.

shaka-perf's habitual long-sync offenders:
- Large JSON parses (multi-MB Lighthouse traces, outcome JSON with
  embedded base64 data URLs).
- `pixelmatch` over hundreds of frame pairs.
- `jpeg-js` decode loops in `profileFramesWithAnnotations`.
- String concat for very large SVG / HTML payloads.

### How to handle them

1. **Route through the pool first.** Submit the heavy call. You get
   the throttle, the sticky-status counter, and a future-proofed
   integration point.

2. **Watch the event-loop watchdog.** `runPipeline` installs a
   process-wide watchdog (`src/pipeline/event-loop-watchdog.ts`). When
   the event loop stalls for ≥ 1s the watchdog prints a `chalk.red`
   warning like:
   ```
   event-loop blocked for 1842ms — heavy synchronous work on the main thread.
   Move it into a worker_threads worker, or chunk it so it yields between batches.
   ```
   Every warning is a TODO. The watchdog can't tell you *which* call
   blocked (V8's stack is gone by the time the loop resumes), but it
   tells you a fix is needed somewhere recent.

3. **Move to `worker_threads`.** For purely CPU-bound work, spawn a
   long-lived `Worker` per audit and route each step through its own
   `pool.submit`. The pool slot is held while the RPC is in flight,
   so every step shows up as its own row in the runner's sticky-status
   panel ("parseProfile", "computeFrames", per-frame composites,
   "writeSvg") and the pool's `parallelism` still caps how many step
   submits run simultaneously across audits. The actual CPU work
   happens off the host pipeline's main thread, in the worker's V8
   isolate on its own OS thread.

   Canonical example: `src/audit/stages/build_annotated_timeline/`:
   - `worker-protocol.ts` — wire types shared by parent and worker.
   - `worker-entry.ts` — long-lived dispatcher; holds parsed profile
     / kept frames / etc. in module-level state so each step picks
     up where the prior one left off without re-serialising across
     the boundary.
   - `worker-client.ts` — thin RPC wrapper; one `request(...)` per
     step, request-id matching, `dispose()` terminates the worker.
   - `engine.ts` — owns the client lifetime, submits each step as
     `workerPool.submit(() => client.someStep(), { key })`. Per-frame
     composites are submitted serially within an audit so cross-audit
     fairness wins over within-audit fan-out (4 audits → 4 frame
     composites in flight, one per worker, drained FIFO).

   Mirror that shape for new stages: one worker per audit, state in
   the worker, dispose in a `finally`.

   **Don't chunk loops with `await new Promise(setImmediate)`** to
   coax the watchdog into staying quiet. That trades one long block
   for a wall-clock smeared across many short blocks while the CPU is
   still pinned to the main thread — slower than the original on a
   single audit, and the audits still serialise.

### Things that already release the main thread

- **sharp / libvips.** `sharp(buf).toBuffer()` runs the codec on libuv
  threads. Pool routing caps concurrency; the work itself is off-loop.
- **Child processes.** `spawn('ffmpeg', ...)` plus `await new
  Promise(resolve => ff.on('exit', resolve))` is off-loop. Use
  `pipeAndFilterStderr` from `src/bench/core/ffmpeg-stderr.ts` to drop
  the glibc dynamic-loader noise; don't `stdio: 'inherit'` stderr.
- **`fs.promises` / async streams.** Reads dispatch on libuv threads.
  Don't replace them with `readFileSync` to "simplify."

### Things that don't

- `JSON.parse` and `JSON.stringify` are sync on the main thread.
- `Buffer.from(str, 'base64')` is sync on the main thread (and so is
  the inverse `.toString('base64')`).
- `crypto.createHash().update().digest()` and other purely-JS digests
  are sync.
- Most npm libraries that aren't built around a native binding.

When in doubt: run the call inside a `pool.submit`, watch the
watchdog, and move to `worker_threads` if the warning fires.

## Report-side considerations

`renderArtifacts` runs inside the report-shell — a Vite + React build
that gets inlined into one self-contained `report.html`. Constraints:

- **No Node-only imports** reach the shell. `fs`, `path`,
  `child_process`, `sharp`, `playwright` — all engine-side. Put them
  in `engine.ts`.
- Anything you want the shell to display must travel through the
  measurement (returned from `run`). Either embed as a data URL
  (`data:image/avif;base64,...`) or persist to disk and pass a
  report-relative href (`<unit_dir>/timeline_frames.svg`).
- No `fetch` at render time — the report is opened from `file://`
  often.

Each stage renders inside a `<section data-stage="<name>">` in the
test card. For per-viewport rendering, iterate `measurements` (already
paired with viewports). For per-card layout like a preview that opens
a fullscreen dialog, use `DetailedArtifactDialog` with
`variant="preview"` (see `build_annotated_timeline/report.tsx`).

## `pipelineConfig` round-trip

The `pipelineConfig` you pass to `createPipeline` is JSON-serialised
into the report. The shell re-instantiates the pipeline by calling
`createMyPipeline(pipelineConfig)` so it can resolve `renderArtifacts`
for each stage. Constraints:

- Plain-old-data only. No functions, no class instances, no `Date`,
  no `Map` / `Set`, no `undefined`-valued keys.
- Don't put credentials or local paths into `pipelineConfig` —
  whatever's there ends up in the report HTML.

## Outcomes on disk

```
<results_root>/<testAndViewportId>/<stage_name>.json
```

```ts
{ kind: 'ok' | 'error' | 'skipped',
  stage,
  measurement?,
  error?,
  reason?,
  logs?,
  runId? }
```

- **`logs`** — every console.log/warn/error captured during the stage,
  including from the worker-pool's retried-failure announcements. Make
  sure your engine uses regular `console.log` — the runner's
  `consoleCaptureStorage` reroutes it transparently.
- **`runId`** — written by the runner. Lets `--report-only` skip
  stale outcomes from earlier shard runs.

The same `<stage_name>.json` is read by `--report-only` to rebuild the
report without re-running anything. Treat it as a stable interchange
format.

## Cancellation semantics

- Stages run on a per-unit chain, so a stage failure for unit K does
  **not** block other units. Subsequent stages on unit K skip
  themselves via `priorOutcomes`.
- A submission whose `key` gets `pool.cancel(key, reason)`'d rejects
  immediately. In-flight task bodies that thread
  `raceCancellation` (the second arg to the `WorkerTask` signature)
  will return promptly; others run to natural completion before the
  rejection lands.

## Polymorphic extensibility reminder

Don't add `switch (stage.name)` to shared modules to dispatch
stage-specific behaviour. The framework calls into the stage's methods
— the stage owns its variant logic. The only allowed name-keyed switch
is the pipeline deserialiser in `src/pipeline/pipeline-artifacts.ts`.
See `.claude/skills/review-architecture/SKILL.md`.

## Checklist for a new stage

- [ ] `stage.ts` with `Stage<M>` implementation; engine lazy-imported.
- [ ] `engine.ts` for the heavy logic.
- [ ] `report.tsx` rendering each viewport's measurement.
- [ ] `index.ts` re-exports the class and the result type.
- [ ] `pipeline.ts`: `pipeline.runStage(workerPool, new MyStage(...))`.
- [ ] `pipelineMetadata.stages` includes the new name.
- [ ] `chipsForAllTests` updated if the chip surface depends on the
  new measurement.
- [ ] Every CPU-significant call inside `engine.ts` routes through
  `pool.submit` with a per-(unit, stage) key.
- [ ] No `console.log` outside `engine.ts` (the report-shell strips
  Node imports anyway, but log captures only happen during `run`).
- [ ] `yarn build` is clean.
- [ ] The watchdog stays silent on a realistic test run, or the
  warnings are tracked as follow-up TODOs.
