# Cumulative executed-code coverage

`shaka-perf audit --categories code_coverage` collects browser Istanbul counters,
keeps the per-test `coverage.json` and `.nyc_output/` mirrors, and generates
`audit-results/coverage/index.html` using bundled Istanbul libraries. No separate
`nyc` installation is needed. Open **All Tests** in the full audit report to view it.
The self-contained audit report keeps per-test measurements; distribute the
`coverage/` directory separately when sharing the interactive Istanbul viewer.

Statement, function, branch, and line coverage describe **executed code**. The
existing per-test screenshots, source attribution and `visibility-map.txt`
describe **screenshot visibility**. Execution does not prove that an element was
visible or captured.

## Instrument the served build

Serve an Istanbul-instrumented application exposing `window.__coverage__`.
Examples include `babel-plugin-istanbul` and `swc-plugin-coverage-instrument`.
Instrumentation belongs in the development/coverage build; it changes runtime
cost and should be disabled when measuring application performance. Missing or
empty coverage fails the measurement with setup instructions.

Instrument before plugins that generate helper code, or provide an
`inputSourceMap` mapping generated locations to original sources. Counters with
line-zero or ambiguous duplicate locations cannot establish truthful source
coverage: the report diagnoses and rejects those files. The demo places its SWC
coverage plugin before the loadable-component plugin for this reason.

## Choose the source denominator

Configure `audit.codeCoverage` in `abtests.config.ts`:

```ts
export default defineConfig({
  // ...shared browser options and other configuration...
  audit: {
    codeCoverage: {
      projectRoot: '.',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/generated/**', 'src/**/*.test.*', 'src/server/**'],
      instrument: instrumentProjectSource,
    },
  },
});
```

`projectRoot` defaults to the configuration file's directory. Include/exclude
patterns use project-relative paths and minimatch glob syntax. Defaults exclude
`**/node_modules/**`, `**/.git/**`, `**/.yarn/**`, `**/audit-results/**`,
`**/*.d.ts`, and `**/*.abtest.*`; custom exclusions are added
to those defaults. The effective root, include patterns, exclusions, contributors,
viewports and original run IDs appear in the HTML and `coverage/scope.json`.
Per-test `config.audit.codeCoverage` overrides follow normal configuration merging.
The aggregate uses the union of the selected tests' effective scopes and lists
which tests use each one. A file excluded by every selected scope stays outside
its denominator; a test can deliberately override a file-level exclusion.
Files outside the scope do not enter the denominator, even when the browser loads
them. Empty include arrays are rejected; patterns matching no files are diagnosed.

**With no `include`, coverage is loaded-files-only.** The viewer explicitly says
this is not whole-project coverage. It cannot discover unvisited project files
or establish a whole-project denominator. Configure source scope to include them.

Typical layouts:

| Configuration location | `projectRoot` | Example `include` |
| --- | --- | --- |
| `app/abtests.config.ts` | `.` | `src/**/*.{js,jsx,ts,tsx}` |
| `app/tools/abtests.config.ts` | `..` | `src/**/*.{js,jsx,ts,tsx}` |
| `repo/abtests.config.ts` | `.` | `apps/shop/src/**`, `packages/ui/src/**` |
| Rails app root | `.` | `app/javascript/components/**/*.tsx`, `app/javascript/hooks/**/*.{ts,tsx}` |

For container builds with coverage paths such as `/app/app/javascript/...`, add
`pathMappings: { '/app': '.' }` when `/app` corresponds to the local project root.
Mappings replace complete path prefixes; longest prefixes win. They apply to
coverage paths and embedded source-map sources. Unavailable local sources are
reported instead of rendering an invented source file. Restore the matching
source checkout before regeneration.

## Initial counters for unvisited files

Eligible files absent from measured coverage need initial counters at **zero**.
For ordinary JavaScript/JSX without extra build transforms, the bundled Istanbul
instrumenter can produce these. For TypeScript/TSX or a custom build pipeline,
provide `instrument(source, absoluteFilename)`, returning Istanbul **FileCoverage
data** (synchronously or asynchronously), not instrumented JavaScript.

The adapter must apply the same syntax handling, build transforms, instrumentation
options and original-source mapping as the served build. It must map back to the
requested source file. ShakaPerf resets every returned hit counter to zero. It
reuses measured templates and checks a supplied adapter against measured code
locations before accepting their hits. A differing shape is diagnosed and excluded.

A Babel project can use its existing transformation options and Istanbul plugin,
returning the transformation's `metadata.coverage`. Ensure the adapter also runs
for files excluded from Babel's usual test-only instrumentation filter. Do not
substitute a generic TS transpiler for a different served build pipeline.

The [demo adapter](../demo-ecommerce/config/coverage-instrument.cjs) shows another
approach: compile every eligible component and hook with the existing Rspack/SWC
loaders, inspect static initial coverage records, and emit no bundle. This also
covers modules never imported by the application. It does not execute modules.
Keep adapter helpers and compiler settings under version control and rebuild the
served application after changing them.

If an eligible file uses unsupported syntax or its adapter fails, the report
lists it, omits its unknowable counters, and labels the report **INCOMPLETE**.
An omitted file is not treated as covered or as a known zero. Fix the adapter or
exclude files deliberately outside the intended runtime scope. Original TS/TSX
source is displayed by Istanbul. When instrumentation occurs after transpilation,
include `inputSourceMap` in its FileCoverage records; mismatched embedded source
content is rejected.

## Run, retain, and regenerate

From the project directory:

```sh
yarn shaka-perf audit --categories code_coverage
# Limit measurement and the cumulative report to selected tests / viewport:
yarn shaka-perf audit --categories code_coverage --filter 'Homepage|Products' --viewport phone
# Keep other saved unit outcomes when adding another measurement:
yarn shaka-perf audit --categories code_coverage --keep-old-results --filter Products
# Rebuild HTML from saved results without launching measurement browsers:
yarn shaka-perf audit --categories code_coverage --report-only
# Regenerate a selected cumulative subset from those same saved records:
yarn shaka-perf audit --categories code_coverage --report-only --filter Homepage --viewport desktop
```

The cumulative viewer includes only selected tests and current configured
viewports; `--viewport` also filters its saved records during regeneration.
The main audit report retains its existing full-suite and viewport display rules.
`--testPathPattern` also limits coverage contributors. Existing retained results
can contribute when their test/viewport belongs to this selection; their original
run IDs are listed. Orphan `.nyc_output` files and outcomes outside the current
configuration cannot select themselves. `--skip-report` writes engine artifacts
without HTML; a later `--report-only` assembles available compatible results.

Hits are merged by source file and code location. Percentages are calculated from
the combined counters, never averaged. Files from conflicting instrumentation are
excluded and diagnosed. Source/test fingerprints bind measurements to local source
bytes and scope settings. Changed source files, tests, scope or adapter functions,
modified mirrors, conflicting recorded Docker build commits, and legacy records without provenance require remeasurement.
Source fingerprints describe the local checkout: operators must still serve its
matching build. Adapter location checks and embedded source content detect many
build mismatches; identical locations alone cannot prove identical served code.

When a test fails, available successful measurements still produce a partial
report. Test/engine failures have a separate disclosure from analysis diagnostics,
and the audit command preserves its nonzero failure status. Report generation
errors also fail the command. An incomplete analysis prints warnings and marks the
HTML; it does not turn a successful test into a failed test assertion.

The CLI prints the report path. `coverage/coverage-final.json` contains the merged
counters, and `coverage/scope.json` records scope, contributors, diagnostics and
failures. Regeneration preserves raw artifacts and does not change measurement
freshness. A new HTML report replaces the previous coverage directory, so an old
successful report cannot masquerade as the result of a failed regeneration.
