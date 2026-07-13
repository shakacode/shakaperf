# Compare Bisect Report-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `shaka-perf compare bisect --report-only` to regenerate the latest bisect HTML report entirely from persisted JSON, and create a compatible JSON sidecar for the current demo report.

**Architecture:** Normal bisect writes persist one validated lightweight payload to `bisect-report.json` and render `bisect-report.html` from that payload. A pure report-only service reads the sidecar and `session.json`, rebuilds only the bisect navigation model, and atomically rewrites both outputs; the CLI routes to it before Git, tests, twin-server, or engine setup.

**Tech Stack:** TypeScript strict mode, Commander.js, Zod, Jest, existing compare report shell.

## Global Constraints

- Runtime report-only support requires `bisect-report.json`; it never parses HTML.
- Report-only performs no Git checkout, build-manifest read, server lease, rebuild, restart, or compare-engine work.
- Positional refs are invalid with `--report-only`.
- Preserve the existing `compare-bisect-results` location and atomically replace outputs.
- Keep changes focused and commit each independently testable behavior.

---

### Task 1: Persist the Portable Report Sidecar

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/report.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/report.test.ts`

**Interfaces:**
- Produces: `BISECT_REPORT_DATA_FILENAME = 'bisect-report.json'`.
- Produces: `writeBisectReport(options): WrittenBisectReport`.
- `WrittenBisectReport` contains `htmlPath`, `dataPath`, and the lightweight `data` used by both files.

- [ ] **Step 1: Write the failing sidecar tests**

Extend `report.test.ts`:

```ts
const result = writeBisectReport({ resultsDirectory, data: reportData(), stages });
const saved = JSON.parse(fs.readFileSync(result.dataPath, 'utf8'));
const embedded = JSON.parse(reportPayload(fs.readFileSync(result.htmlPath, 'utf8')));

expect(path.basename(result.dataPath)).toBe('bisect-report.json');
expect(saved).toEqual(embedded);
expect(saved.meta.reportMode).toBe('lightweight');
```

Also prewrite both files, force the JSON rename to fail, and assert neither prior file changed.

- [ ] **Step 2: Run the report test and verify RED**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report.test.ts --runInBand`

Expected: FAIL because the sidecar constant and structured return value do not exist.

- [ ] **Step 3: Implement one portable payload and two atomic writes**

```ts
export const BISECT_REPORT_FILENAME = 'bisect-report.html';
export const BISECT_REPORT_DATA_FILENAME = 'bisect-report.json';

export interface WrittenBisectReport {
  htmlPath: string;
  dataPath: string;
  data: BisectReportData;
}

function writeFileAtomic(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
```

Prepare the lightweight payload once with `reportDataForMode`, write pretty JSON first, render HTML from the same value, and return all three fields.

- [ ] **Step 4: Run the report test and verify GREEN**

Run the Task 1 command. Expected: PASS.

- [ ] **Step 5: Commit persisted report artifacts**

```bash
git add packages/shaka-perf/src/compare/bisect/report.ts packages/shaka-perf/src/compare/bisect/__tests__/report.test.ts
git commit -m "feat(shaka-perf): persist bisect report data"
```

---

### Task 2: Regenerate Reports from Validated State

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/report-only.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/report-only.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/report.ts`

**Interfaces:**
- Produces: `regenerateBisectReport(options: RegenerateBisectReportOptions): RegeneratedBisectReport`.
- Consumes: `session.json`, `bisect-report.json`, and current report stages.
- Returns: `{ session: BisectSession; htmlPath: string; dataPath: string }`.

- [ ] **Step 1: Write failing pure-regeneration tests**

Create valid saved session and report fixtures, then assert:

```ts
const result = regenerateBisectReport({ resultsDirectory, stages, now: fixedNow });
const saved = JSON.parse(fs.readFileSync(result.dataPath, 'utf8'));

expect(saved.meta.reportOnly).toBe(true);
expect(saved.meta.generatedAt).toBe(fixedNow);
expect(saved.tests).toEqual(original.tests);
expect(saved.bisect.targets[0].status).toBe('found');
expect(saved.bisect.targets[0].firstBadSha).toBe('middle');
```

Also test missing and invalid session/report JSON. Prewrite HTML and assert validation failures never replace it.

- [ ] **Step 2: Run the report-only test and verify RED**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report-only.test.ts --runInBand`

Expected: FAIL because `regenerateBisectReport` does not exist.

- [ ] **Step 3: Implement focused Zod readers and regeneration**

Define passthrough schemas requiring every field consumed by `buildBisectReportModel` and the renderer. Parse errors must name the exact file. Regenerate with:

```ts
const generatedAt = options.now ?? new Date().toISOString();
const data: BisectReportData = {
  ...savedReport,
  meta: { ...savedReport.meta, generatedAt, reportOnly: true },
  bisect: buildBisectReportModel(session, savedReport.tests, generatedAt),
};
const written = writeBisectReport({
  resultsDirectory: options.resultsDirectory,
  data,
  stages: options.stages,
});
return { session, htmlPath: written.htmlPath, dataPath: written.dataPath };
```

The report schema requires `meta`, `tests`, and `bisect`. The session schema requires version `1`, status, refs, original checkout, ordered commits, targets, observations, and commit runs while allowing existing optional fields.

- [ ] **Step 4: Run report-only and writer tests**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report-only.test.ts src/compare/bisect/__tests__/report.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit pure report regeneration**

```bash
git add packages/shaka-perf/src/compare/bisect/report-only.ts packages/shaka-perf/src/compare/bisect/report.ts packages/shaka-perf/src/compare/bisect/__tests__/report-only.test.ts
git commit -m "feat(shaka-perf): regenerate saved bisect reports"
```

---

### Task 3: Route the CLI Without Bisect Infrastructure

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/cli.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`

**Interfaces:**
- Adds: `BisectCliOptions.reportOnly: boolean`.
- Adds: `BisectCliRuntimeDependencies.regenerateReport`.
- Report-only returns the validated saved session after printing the HTML path.

- [ ] **Step 1: Write failing CLI-routing tests**

```ts
await program.parseAsync(['compare', 'bisect', '--report-only'], { from: 'user' });
expect(run).toHaveBeenCalledWith(
  undefined,
  undefined,
  expect.objectContaining({ reportOnly: true }),
);
```

Add runtime tests where `regenerateReport` returns a fixture while `resolveTwinServers`, `loadFrozenTests`, and `run` throw if called. Assert none are called. Add a positional-ref test expecting `compare bisect --report-only does not accept good-ref or bad-ref`.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/cli.test.ts --runInBand`

Expected: FAIL because the bisect subcommand has no report-only option or early route.

- [ ] **Step 3: Add the early report-only route**

Register:

```ts
.option(
  '--report-only',
  'Re-render compare-bisect-results/bisect-report.html from saved bisect report data',
  false,
)
```

After config parsing, branch before requiring twin servers or loading tests:

```ts
if (cliOptions.reportOnly) {
  if (goodRef || badRef) {
    throw new Error('compare bisect --report-only does not accept good-ref or bad-ref');
  }
  const pipeline = createComparePipeline(comparePipelineConfigFromAbTests(config));
  const result = (runtime.regenerateReport ?? regenerateBisectReport)({
    resultsDirectory: path.resolve(cwd, 'compare-bisect-results'),
    stages: pipeline.stages,
  });
  console.log(`Bisect report: ${result.htmlPath}`);
  return result.session;
}
```

- [ ] **Step 4: Run CLI and report-only tests**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/cli.test.ts src/compare/bisect/__tests__/report-only.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit CLI support**

```bash
git add packages/shaka-perf/src/compare/bisect/cli.ts packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts
git commit -m "feat(shaka-perf): add bisect report-only CLI"
```

---

### Task 4: Migrate the Current Report and Document Usage

**Files:**
- Modify: `packages/shaka-perf/README.md`
- Modify: `packages/shaka-perf/README-compare-bisect.md`
- Generate ignored artifact: `demo-ecommerce/compare-bisect-results/bisect-report.json`

**Interfaces:**
- Documents: `shaka-perf compare bisect --report-only`.
- Produces one compatible JSON sidecar from the current embedded HTML payload.

- [ ] **Step 1: Extract the current embedded payload once**

Use a one-time Node command to read the `__shaka_report_data__` script from the current HTML, parse it, and pretty-print it to `demo-ecommerce/compare-bisect-results/bisect-report.json`. Fail if the script is absent or malformed.

- [ ] **Step 2: Verify the one-time sidecar is compatible**

Run: `cd demo-ecommerce && yarn shaka-perf compare bisect --report-only`

Expected: exits zero, prints the absolute HTML path, does not check out a commit, and does not require running twin servers.

- [ ] **Step 3: Document normal and report-only usage**

Add:

```bash
shaka-perf compare bisect --report-only
```

Explain that it regenerates the latest report from `session.json` and `bisect-report.json`, performs no measurements, and requires a sidecar produced by a current-version bisect run.

- [ ] **Step 4: Run focused and broad verification**

Run the focused bisect files:

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report.test.ts src/compare/bisect/__tests__/report-only.test.ts src/compare/bisect/__tests__/cli.test.ts src/compare/bisect/__tests__/session.test.ts --runInBand
```

Then run `yarn workspace shaka-perf test --runInBand`, `yarn build`, and `git diff --check`.

Expected: all tests and build pass; `git diff --check` prints nothing.

- [ ] **Step 5: Commit documentation**

```bash
git add packages/shaka-perf/README.md packages/shaka-perf/README-compare-bisect.md
git commit -m "docs(shaka-perf): document bisect report-only mode"
```

The generated demo sidecar remains in the ignored local results directory for manual testing and is not committed.
