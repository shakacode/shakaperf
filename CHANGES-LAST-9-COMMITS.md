# Summary of Last 9 Commits

## b45b891b — Unify visreg-compare and perf-compare into single report (#137) — **MAJOR / BREAKING**

The biggest change by far. Collapses three config/command surfaces into one.

**CLI / schema changes (BREAKING):**
- New top-level `shaka-perf compare` command replaces the legacy pair. `perf-compare`, `perf-analyze`, `perf-report`, `perf-init`, `visreg-compare`, `visreg-init` are **deleted**.
- New unified [abtests.config.ts](demo-ecommerce/abtests.config.ts) (with zod-validated slices `{shared, visreg, perf, twinServers}`) replaces `bench.config.ts`, `visreg.config.ts`, and `twin-servers.config.ts`. The three legacy files are removed from `demo-ecommerce`.
- `defineConfig()` entry point lives at [packages/shaka-perf/src/compare/config.ts](packages/shaka-perf/src/compare/config.ts).
- `--categories visreg,perf` flag selects what runs; `--skip-engines` re-harvests/re-renders without measuring.
- `--filter` now accepts either a name regex/substring or a path to a single `.abtest.ts` file. **`--testFile` is dropped.**
- Flag rename: **`sampleTimeout` → `sampleTimeoutMs`** (drops the seconds→ms multiplier — same name, different unit semantics).
- zod `.partial()` removed from `SharedConfigSchema` / `VisregConfigSchema` / `PerfConfigSchema` — defaults now actually apply. New perf defaults: `parallelism = max(1, cpus/2)`, `samplingMode = simultaneous`.
- `samplingMode` enum corrected to `sequential | simultaneous`.
- `compare` exits non-zero on any regression / visual mismatch / engine error.

**Significant surface changes:**
- New React 19 + Vite single-file report shell at [packages/shaka-perf/report-shell/](packages/shaka-perf/report-shell/). All assets inlined as base64 into one self-contained `compare-results/report.html` (~10MB). Old webpack-based viewer + `@babel/*`, `file-loader`, `backstop-twentytwenty`, `assert` deps deleted.
- Legacy Handlebars bench report kept internally (restored in a later sub-commit) and shipped as drill-down `artifact-<n>.html`.
- Per-test isolation: worker `unhandledRejection`/`uncaughtException` caught, errors surface in the report as a banner + per-card chip + dialog with full stdout/stderr transcript from `<slug>/engine-output.log`.
- Report features: click-to-zoom visreg dialog with before/after scrubber, timeline preview SVG, grouped vitals/diagnostics perf tables with `%Δ` column, multi-status pills, `error` as a top-level status.
- `shaka-shared`: new `findAbTestsConfig` / `loadAbTestsConfig` / `readTestSource` / `embedAsBase64`. `loadTests` now snapshots and restores the test registry to survive multi-engine runs against tsx's ESM cache.
- Type dedup: `ITBConfig` and `VisregGlobalConfig` are now `Partial<PerfConfig>` / `Partial<VisregConfig>` derived from the zod schemas.
- `visreg/core/runner` returns `{passed, failed}` instead of throwing `'Mismatch errors found.'`.

## aeb00a7c — Bump `shaka-shared` to 0.0.6 (#135)
Version bump only.

## 75db444e — demo-ecommerce: webpack → rspack (#130) — **significant**

**CLI / schema changes (shaka-bundle-size):**
- New **`generate-stats`** command, extracted from both `compare` and `upload-main-branch-stats`. `compare` now uses `checkFromFiles()` and no longer runs `ExtendedStatsGenerator`. `generate-stats` writes to `currentDir`; `upload-main-branch-stats` uploads from `currentDir` (was `baselineDir`).
- `ExtendedStatsGenerator.generate()` now returns a structured result distinguishing "stats missing" vs "analyzer failed" (previously both returned `null`).

**Other:** demo-ecommerce `config/webpack/` renamed to `config/rspack/`, babel dropped, `@swc/plugin-loadable-components` injected to preserve loadable code-splitting, `compression-webpack-plugin` restored to keep `.gz/.br` siblings. Added verbose logging to BaselineStorage / BundleSizeChecker.

## d26f8739 — Tune perf sensitivity (#134)
`demo-ecommerce/bench.config.ts` only: `cpuSlowdownMultiplier` 1→20, parallelism 2→6, samples 6→18.

## f97379a3 — Disable CodeRabbit (#133)
Adds `.coderabbit.yaml`.

## f45287d5 — CPU-noise-resilient perf tests (#131) — **significant**

**CLI additions (bench):**
- `--parallelism` (run N measurement pairs concurrently)
- `--duration` (fixed time window instead of fixed sample count)
- `--sampling-mode <sequential|simultaneous>` (default `simultaneous`)
- `--hydration-delay` option in the demo for sensitivity testing
- Removes GC option

**Statistics (BREAKING output semantics):**
- Switches from unpaired Mann-Whitney U + Cartesian Hodges-Lehmann to **paired Wilcoxon Signed-Rank + paired Hodges-Lehmann** with Walsh-averages CI. `wilcoxon-rank-sum.ts` deleted.
- Fixes bug where `Stats` sorted its input in place, destroying control[i]/experiment[i] pairing.
- On-disk artifact renamed **`compare.json` → `ab-measurements.json`** (file, parser, identifiers, fixtures, integration logs).

**Other:** Each Lighthouse sample runs in a forked child process (`lighthouse-worker.ts`) to avoid marky collisions. Control+experiment samples run in parallel (`Promise.all`/`Promise.allSettled`). New `OOPLighthouseSampler` with proper dispose. Simultaneous mode halves per-sampler worker count for CPU parity.

## 52706cf6 — Flatten CLI commands (#132) — **BREAKING**

Nested subcommand groups replaced by flat top-level commands:
- `shaka-perf bench compare` → `shaka-perf perf-compare`
- `shaka-perf visreg compare` → `shaka-perf visreg-compare`
- `shaka-perf twin-servers build` → `shaka-perf twins-build`

Each domain's `create*Program()` now returns `Command[]` instead of a single parent `Command`. Global `--config` / `--verbose` are attached per-command. CircleCI orb, Procfile, and all READMEs updated. (Note: this whole surface is then deleted by #137 above.)

## 72e50645 — Update snapshots (#129)
Snapshot-only (integration-tests).

## 03ae3438 — Default markers fallback and static lighthouse import (#128)
[packages/shaka-perf/src/bench/core/create-lighthouse-benchmark.ts](packages/shaka-perf/src/bench/core/create-lighthouse-benchmark.ts) and [run-lighthouse.ts](packages/shaka-perf/src/bench/core/run-lighthouse.ts): use `DEFAULT_MARKERS` when none specified; switch lighthouse to static import.

---

## Breaking-change headline

If a downstream consumer last saw this repo before these nine commits, the breaking surface is:

1. **Entire CLI renamed twice** — once to `perf-*` / `visreg-*` / `twins-*` (#132), then the `perf-*` and `visreg-*` groups were **deleted** in favour of a single `compare` (#137). Only `twins-*` survives.
2. **Config files consolidated** — `bench.config.ts` + `visreg.config.ts` + `twin-servers.config.ts` → single `abtests.config.ts` with nested slices.
3. **Flag renames**: `sampleTimeout` → `sampleTimeoutMs`; `--testFile` removed (folded into `--filter`); `samplingMode` enum tightened.
4. **shaka-bundle-size**: `generate-stats` is now a separate step; `compare` no longer runs it.
5. **Bench artifact renamed**: `compare.json` → `ab-measurements.json`.
6. **Stats method changed**: paired Wilcoxon + paired Hodges-Lehmann replace Mann-Whitney U — p-values and point estimates for the same input are now numerically different.
