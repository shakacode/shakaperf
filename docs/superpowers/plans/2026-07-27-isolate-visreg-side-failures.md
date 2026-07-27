# Isolate Visreg Side Failures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stateful cross-side failure handling from commit `6cb13c6d` with explicit side-owned errors and artifact selection.

**Architecture:** A small visreg failure module owns side attribution and cause-chain lookup. `runCompareAttempts` wraps each concurrent side operation at the point where its live page is available, while the compare stage uses that metadata to select artifacts without crossing sides.

**Tech Stack:** TypeScript, Node.js `AsyncLocalStorage`, Jest, Playwright page abstractions, Yarn workspaces.

## Global Constraints

- Control errors must never inherit experiment annotations or screenshots, and experiment errors must never inherit control metadata.
- Experiment is the primary failure when both sides fail.
- Paired operations must settle before either browser context is disposed.
- Screenshot capture and browser disposal must never mask the original comparison error.
- Retry and pixel-comparison behavior must remain unchanged.
- Run `nvm use` from the repository root before repository commands; in this environment use the installed `v24.13.0` with `--delete-prefix`.
- Use `.agents/bin/validate` for the final repository validation.

---

## File Structure

- Create `packages/shaka-perf/src/visreg/core/side-failure.ts`: typed side failure and cause-chain lookup.
- Create `packages/shaka-perf/src/visreg/core/__tests__/side-failure.test.ts`: focused error-model tests.
- Modify `packages/shaka-perf/src/visreg/core/util/runCompareAttempts.ts`: paired side execution and failure capture.
- Modify `packages/shaka-perf/src/visreg/core/util/__tests__/runCompareAttempts.test.ts`: observable side-attribution regressions.
- Modify `packages/shaka-perf/src/visreg/core/util/createComparisonSide.ts`: remove failure-only side identity from browser resource construction.
- Create `packages/shaka-perf/src/compare/stages/visreg/failure-screenshot.ts`: choose an exact or side-scoped failure screenshot.
- Create `packages/shaka-perf/src/compare/stages/visreg/__tests__/failure-screenshot.test.ts`: filesystem-backed artifact-selection tests.
- Modify `packages/shaka-perf/src/compare/stages/visreg/run.ts`: delegate failure screenshot selection.
- Modify `packages/shaka-perf/src/visreg/core/util/createComparisonBitmaps.ts`: express browser lifetime with `try`/`finally`.
- Verify `packages/shaka-perf/src/test-annotation/index.ts` and `packages/shaka-perf/src/test-annotation/__tests__/test-annotation.test.ts` unchanged behavior.
- Modify `packages/shaka-shared/src/ab-test-registry.ts` only if its existing comment needs terminology aligned with the final behavior.

### Task 1: Typed Side Failure

**Files:**
- Create: `packages/shaka-perf/src/visreg/core/side-failure.ts`
- Create: `packages/shaka-perf/src/visreg/core/__tests__/side-failure.test.ts`

**Interfaces:**
- Produces: `VisregSide = 'control' | 'experiment'`
- Produces: `VisregSideFailure extends Error`
- Produces: `findVisregSideFailure(error: unknown): VisregSideFailure | undefined`

- [ ] **Step 1: Write the failing side-failure tests**

```ts
import {
  findVisregSideFailure,
  VisregSideFailure,
} from '../side-failure';

describe('VisregSideFailure', () => {
  it('preserves the original error as its cause and records side metadata', () => {
    const cause = new Error('experiment prepare failed');
    const failure = new VisregSideFailure(
      'experiment',
      cause,
      '/tmp/failure-experiment.png',
    );

    expect(failure).toMatchObject({
      name: 'VisregSideFailure',
      message: 'experiment prepare failed',
      side: 'experiment',
      screenshotPath: '/tmp/failure-experiment.png',
      cause,
    });
  });

  it('finds a side failure through wrapper causes', () => {
    const failure = new VisregSideFailure('control', new Error('boom'));
    const wrapper = new Error('outer', { cause: failure });

    expect(findVisregSideFailure(wrapper)).toBe(failure);
  });

  it('returns undefined for cyclic cause chains without side metadata', () => {
    const error = new Error('cycle') as Error & { cause?: unknown };
    error.cause = error;

    expect(findVisregSideFailure(error)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
source /home/romex/.nvm/nvm.sh >/dev/null 2>&1 || true
nvm use --delete-prefix v24.13.0 --silent
yarn workspace shaka-perf test --runInBand src/visreg/core/__tests__/side-failure.test.ts
```

Expected: FAIL because `../side-failure` does not exist.

- [ ] **Step 3: Implement the error model**

```ts
export type VisregSide = 'control' | 'experiment';

export class VisregSideFailure extends Error {
  readonly side: VisregSide;
  readonly screenshotPath?: string;

  constructor(side: VisregSide, cause: unknown, screenshotPath?: string) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message, { cause });
    this.name = 'VisregSideFailure';
    this.side = side;
    this.screenshotPath = screenshotPath;
  }
}

export function findVisregSideFailure(
  error: unknown,
): VisregSideFailure | undefined {
  const seen = new Set<unknown>();
  let cursor = error;
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor instanceof VisregSideFailure) return cursor;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}
```

Include the repository copyright header.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the error model**

```bash
git add packages/shaka-perf/src/visreg/core/side-failure.ts \
  packages/shaka-perf/src/visreg/core/__tests__/side-failure.test.ts
git commit -m "Add typed visreg side failures"
```

### Task 2: Simplify Paired Side Execution

**Files:**
- Modify: `packages/shaka-perf/src/visreg/core/util/runCompareAttempts.ts`
- Modify: `packages/shaka-perf/src/visreg/core/util/createComparisonSide.ts`
- Modify: `packages/shaka-perf/src/visreg/core/util/__tests__/runCompareAttempts.test.ts`

**Interfaces:**
- Consumes: `VisregSide`, `VisregSideFailure`, and `findVisregSideFailure` from Task 1.
- Restores: `createComparisonSide(browser, config, viewport, onContextReady?)`.
- Preserves: `runCompareAttempts(deps, params): Promise<CompareSelectorOutcome[]>`.

- [ ] **Step 1: Change regression expectations to the side-failure API**

Import `findVisregSideFailure` and replace raw-error identity/property assertions:

```ts
await expect(run(deps, makeConfig())).rejects.toMatchObject({
  name: 'VisregSideFailure',
  side: 'experiment',
  cause: prepareError,
  screenshotPath: '/tmp/failure-experiment.png',
});
```

For screenshot capture failure:

```ts
try {
  await run(deps, makeConfig());
  throw new Error('expected run to fail');
} catch (error) {
  expect(findVisregSideFailure(error)).toMatchObject({
    side: 'experiment',
    cause: captureError,
    screenshotPath: '/tmp/failure-experiment.png',
  });
}
```

Add creation-failure coverage:

```ts
it('attributes side creation failures without borrowing the live control page', async () => {
  const createError = new Error('experiment context failed');
  const { deps, createSide } = makeDeps(() => png(BLUE));
  const createSideImpl = createSide.getMockImplementation()!;
  createSide
    .mockImplementationOnce(createSideImpl)
    .mockRejectedValueOnce(createError);

  await expect(run(deps, makeConfig())).rejects.toMatchObject({
    name: 'VisregSideFailure',
    side: 'experiment',
    cause: createError,
  });
  expect(captureFailureScreenshot).not.toHaveBeenCalled();
});
```

Make `makeDeps.createSide` infer control then experiment from call order again,
and remove the synthetic `side` property from its returned resources.

- [ ] **Step 2: Run the attempt-loop tests and verify RED**

Run:

```bash
source /home/romex/.nvm/nvm.sh >/dev/null 2>&1 || true
nvm use --delete-prefix v24.13.0 --silent
yarn workspace shaka-perf test --runInBand src/visreg/core/util/__tests__/runCompareAttempts.test.ts
```

Expected: FAIL because the loop still throws and mutates original errors instead of throwing `VisregSideFailure`.

- [ ] **Step 3: Restore browser-resource-only side construction**

Remove `ComparisonSideName`, `ComparisonSide.side`, and the `side` parameter
from `createComparisonSide`. Restore the injected dependency signature:

```ts
createSide?: (
  browser: Browser,
  config: DecoratedCompareConfig,
  viewport: Viewport,
  onContextReady?: (context: BrowserContext) => Promise<void>,
) => Promise<ComparisonSide>;
```

- [ ] **Step 4: Replace maps and flags with side wrappers**

Delete `attachFailureScreenshotPath`, `capturedFailurePaths`,
`sideSpecificFailure`, and `captureFailures`.

Add a best-effort wrapper:

```ts
const toSideFailure = async (
  side: VisregSide,
  resources: ComparisonSide | undefined,
  cause: unknown,
): Promise<VisregSideFailure> => {
  if (!resources) return new VisregSideFailure(side, cause);
  try {
    const screenshotPath = failureScreenshotPath(
      config,
      scenario,
      viewport,
      side === 'control',
    );
    await captureFailureScreenshot(resources.page, screenshotPath);
    return new VisregSideFailure(side, cause, screenshotPath);
  } catch (captureError) {
    logger.warn(
      `Could not capture ${side} failure screenshot: ${errorMessage(captureError)}`,
    );
    return new VisregSideFailure(side, cause);
  }
};
```

Create resources with explicit call-site ownership:

```ts
let controlSide: ComparisonSide | undefined;
let experimentSide: ComparisonSide | undefined;

controlSide = await createSide(
  browser,
  config,
  viewport,
  setUpSide(scenario.referenceUrl!, true),
).catch((cause) => {
  throw new VisregSideFailure('control', cause);
});

experimentSide = await createSide(
  browser,
  config,
  viewport,
  setUpSide(scenario.url, false),
).catch((cause) => {
  throw new VisregSideFailure('experiment', cause);
});
```

Add paired-operation helpers local to `runCompareAttempts`:

```ts
const runOnSide = async <T>(
  side: VisregSide,
  resources: ComparisonSide,
  body: () => Promise<T>,
): Promise<T> => {
  try {
    return await withLogPrefix(formatLogPrefix(side), body);
  } catch (cause) {
    throw await toSideFailure(side, resources, cause);
  }
};

const settlePair = async <C, E>(
  control: Promise<C>,
  experiment: Promise<E>,
): Promise<[C, E]> => {
  const [controlResult, experimentResult] = await Promise.allSettled([
    control,
    experiment,
  ]);
  if (experimentResult.status === 'rejected') {
    if (controlResult.status === 'rejected') {
      logger.warn(
        `Control side failed while experiment also failed: ${
          errorMessage(controlResult.reason)
        }`,
      );
    }
    throw experimentResult.reason;
  }
  if (controlResult.status === 'rejected') throw controlResult.reason;
  return [controlResult.value, experimentResult.value];
};
```

Use `settlePair(runOnSide(...), runOnSide(...))` for both preparation and
selector capture. Convert missing-selector results to one
`toSideFailure`; choose experiment when both are missing.

In the outer catch, leave existing side failures unchanged and attribute
otherwise-unscoped errors to the live experiment page:

```ts
if (findVisregSideFailure(error) || !experimentSide) throw error;
throw await toSideFailure('experiment', experimentSide, error);
```

Dispose defined resources in `finally`.

- [ ] **Step 5: Run attempt-loop and annotation tests**

Run:

```bash
yarn workspace shaka-perf test --runInBand \
  src/visreg/core/util/__tests__/runCompareAttempts.test.ts \
  src/test-annotation/__tests__/test-annotation.test.ts
```

Expected: PASS. Annotation failures retain the annotation on the original
`cause`, and each side capture is called only for that side.

- [ ] **Step 6: Typecheck the package**

Run:

```bash
yarn workspace shaka-perf typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit the paired execution refactor**

```bash
git add packages/shaka-perf/src/visreg/core/util/runCompareAttempts.ts \
  packages/shaka-perf/src/visreg/core/util/createComparisonSide.ts \
  packages/shaka-perf/src/visreg/core/util/__tests__/runCompareAttempts.test.ts
git commit -m "Isolate concurrent visreg side failures"
```

### Task 3: Select Failure Screenshots by Side

**Files:**
- Create: `packages/shaka-perf/src/compare/stages/visreg/failure-screenshot.ts`
- Create: `packages/shaka-perf/src/compare/stages/visreg/__tests__/failure-screenshot.test.ts`
- Modify: `packages/shaka-perf/src/compare/stages/visreg/run.ts`

**Interfaces:**
- Consumes: `findVisregSideFailure(error)` from Task 1.
- Produces: `findVisregFailureScreenshot(error, artifactsDir, sinceMs): string | undefined`.

- [ ] **Step 1: Write filesystem-backed selection tests**

Create temporary `control_screenshots` and `experiment_screenshots`
directories. Write distinct PNG placeholder files with current mtimes.

Test exact-path selection:

```ts
const failure = new VisregSideFailure(
  'control',
  new Error('boom'),
  controlPath,
);
expect(findVisregFailureScreenshot(failure, root, startedAt)).toBe(controlPath);
```

Test a wrapped side failure without an exact path:

```ts
const failure = new Error('wrapper', {
  cause: new VisregSideFailure('control', new Error('boom')),
});
expect(findVisregFailureScreenshot(failure, root, startedAt)).toBe(controlPath);
```

Even when the experiment file is newer, the second assertion must return the
control path. Add an unattributed-error case that returns the newest file
across both sides, preserving the engine-level fallback.

- [ ] **Step 2: Run the selector tests and verify RED**

Run:

```bash
source /home/romex/.nvm/nvm.sh >/dev/null 2>&1 || true
nvm use --delete-prefix v24.13.0 --silent
yarn workspace shaka-perf test --runInBand \
  src/compare/stages/visreg/__tests__/failure-screenshot.test.ts
```

Expected: FAIL because `failure-screenshot.ts` does not exist.

- [ ] **Step 3: Implement side-aware path lookup**

Implement:

```ts
export function findVisregFailureScreenshot(
  error: unknown,
  artifactsDir: string,
  sinceMs: number,
): string | undefined {
  const sideFailure = findVisregSideFailure(error);
  if (
    sideFailure?.screenshotPath &&
    fs.existsSync(sideFailure.screenshotPath)
  ) {
    return sideFailure.screenshotPath;
  }

  const sides: VisregSide[] = sideFailure
    ? [sideFailure.side]
    : ['experiment', 'control'];
  return newestPng(
    sides.map((side) => path.join(artifactsDir, `${side}_screenshots`)),
    sinceMs,
  );
}
```

Move the recursive PNG walk from `run.ts` into this module. `newestPng`
must ignore unreadable directories/files and files older than `sinceMs`.
Include the repository copyright header.

- [ ] **Step 4: Delegate stage artifact selection**

In `run.ts`, replace `attributedFailureScreenshotPath`,
`captureVisregFailureScreenshot`, and `walkPngs` with:

```ts
const screenshotPath = findVisregFailureScreenshot(
  err,
  unitArtifactsDir,
  startedAt,
);
const captured = screenshotPath
  ? await inlineFailureScreenshot(ctx, screenshotPath)
  : undefined;
```

Keep `inlineFailureScreenshot` best effort and unchanged apart from formatting.

- [ ] **Step 5: Run focused stage and attempt tests**

Run:

```bash
yarn workspace shaka-perf test --runInBand \
  src/compare/stages/visreg/__tests__/failure-screenshot.test.ts \
  src/visreg/core/__tests__/side-failure.test.ts \
  src/visreg/core/util/__tests__/runCompareAttempts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit artifact selection**

```bash
git add packages/shaka-perf/src/compare/stages/visreg/failure-screenshot.ts \
  packages/shaka-perf/src/compare/stages/visreg/__tests__/failure-screenshot.test.ts \
  packages/shaka-perf/src/compare/stages/visreg/run.ts
git commit -m "Select visreg failure screenshots by side"
```

### Task 4: Make Browser Cleanup Explicit

**Files:**
- Modify: `packages/shaka-perf/src/visreg/core/util/createComparisonBitmaps.ts`

**Interfaces:**
- Preserves: `createComparisonBitmaps(config)` behavior and return value.
- Guarantees: a comparison failure remains primary if browser disposal also fails.

- [ ] **Step 1: Replace the nested Promise constructor**

There is no existing unit-test seam for this private orchestration function.
Keep this a mechanical control-flow refactor and do not add production exports
solely for a mock-based test.

Make `delegateCompareScenarios` async:

```ts
async function delegateCompareScenarios(
  config: DecoratedCompareConfig,
): Promise<CompareResult[]> {
  // Build scenarioViews and asyncCaptureLimit as today.
  const browser = await createPlaywrightBrowser(config);
  logger.log('Browser created');
  for (const view of scenarioViews) view._playwrightBrowser = browser;

  let comparisonFailed = false;
  try {
    return await pMap(
      scenarioViews as Required<ScenarioView>[],
      (view) => runCompareScenario.playwright(view),
      { concurrency: asyncCaptureLimit },
    );
  } catch (error) {
    comparisonFailed = true;
    throw error;
  } finally {
    try {
      await disposePlaywrightBrowser(browser);
    } catch (disposeError) {
      if (!comparisonFailed) throw disposeError;
      logger.warn(
        `Could not dispose Playwright browser after comparison failure: ${
          disposeError instanceof Error
            ? disposeError.message
            : String(disposeError)
        }`,
      );
    }
  }
}
```

This removes the unresolved-promise edge case and the duplicated resolve/reject
branches.

- [ ] **Step 2: Run package typecheck and focused visreg tests**

Run:

```bash
yarn workspace shaka-perf typecheck
yarn workspace shaka-perf test --runInBand \
  src/visreg/core/__tests__/side-failure.test.ts \
  src/visreg/core/util/__tests__/runCompareAttempts.test.ts \
  src/compare/stages/visreg/__tests__/failure-screenshot.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit cleanup refactor**

```bash
git add packages/shaka-perf/src/visreg/core/util/createComparisonBitmaps.ts
git commit -m "Simplify visreg browser cleanup"
```

### Task 5: Final Verification

**Files:**
- Verify: all files changed in Tasks 1–4.
- Verify: `packages/shaka-perf/src/test-annotation/index.ts`
- Verify: `packages/shaka-perf/src/test-annotation/__tests__/test-annotation.test.ts`
- Verify: `packages/shaka-shared/src/ab-test-registry.ts`

**Interfaces:**
- Confirms every global constraint and approved design requirement.

- [ ] **Step 1: Run formatting and diff checks**

Run:

```bash
git diff --check 6cb13c6d^..HEAD
git status --short
```

Expected: no whitespace errors; only intentional files are present.

- [ ] **Step 2: Run focused regression tests**

Run:

```bash
yarn workspace shaka-perf test --runInBand \
  src/test-annotation/__tests__/test-annotation.test.ts \
  src/visreg/core/__tests__/side-failure.test.ts \
  src/visreg/core/util/__tests__/runCompareAttempts.test.ts \
  src/compare/stages/visreg/__tests__/failure-screenshot.test.ts
```

Expected: all suites pass.

- [ ] **Step 3: Run repository validation**

Run:

```bash
.agents/bin/validate
```

Expected: build, typecheck, tests, and demo production bundle all exit 0.

- [ ] **Step 4: Review the final commit range**

Run:

```bash
git log --oneline 6cb13c6d^..HEAD
git diff --stat 6cb13c6d^..HEAD
git status --short
```

Expected: the original fix is represented by small responsibility-focused
commits, the worktree is clean, and no unrelated files changed.
