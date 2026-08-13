/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type { AbTestDefinition, Viewport } from 'shaka-shared';
import type { AbTestsConfig } from '../config';
import {
  mimeTypeForArtifactPath,
  type ArtifactStore,
} from './artifact-store';
import { persistedOutcomeInScope } from './viewport-plan';
import type { Outcome } from './outcome';
import type { Pipeline } from './pipeline';
import type {
  SelfContainedReportStrip,
  Stage,
  StageLogger,
  StageName,
  StageRenderContext,
  StageRuntime,
} from '../stage/stage';
import type { ReportMode } from './report-mode';
import { resolveUrl } from './unit-urls';

export interface ChipDescriptor {
  tag: string;
  text: string;
  color: 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'purple';
  sortingWeight: number;
  tagHiddenByDefault?: boolean;
  tooltip?: string;
  // When false, this chip is shown on the card but excluded from the
  // sort key used to order cards in the grid. Lets a stage emit
  // informational chips without those values shuffling the grid order.
  affectsCardOrder?: boolean;
}

/**
 * A per-test value on a named sort dimension. The pipeline emits these
 * polymorphically (`pipeline.sortsForAllTests`) the same way it emits chips;
 * the report shell collects the distinct `tag`s into a "Sort by" row and, when
 * one is selected, orders the cards by each test's `value` on that dimension.
 * A test that doesn't report a dimension simply omits its descriptor and sinks
 * to the end when that dimension is the active sort.
 */
export interface SortDescriptor {
  /** Sort-dimension id; groups the chip across tests (e.g. "LCP"). */
  tag: string;
  /** Human label for the sort chip. */
  label: string;
  /** This test's numeric value on the dimension — the card-ordering key. */
  value: number;
  /** Pre-formatted value for the chip/card tooltip (e.g. "2.5 s", "+12%"). */
  display?: string;
  /**
   * Default direction: when true a larger `value` is worse, so the worst-first
   * default orders descending; when false/omitted smaller is worse and
   * worst-first orders ascending. The shell lets the user flip this per click.
   */
  higherIsWorse?: boolean;
  /** Optional chip colour hint. */
  color?: ChipDescriptor['color'];
  /** Optional chip tooltip. */
  tooltip?: string;
}

export type Status =
  | 'error'
  | 'regression'
  | 'visual_change'
  | 'improvement'
  | 'no_difference'
  /**
   * Category produced no work for this test (e.g. its stage's `applies()`
   * declined). Rendered as a small "skipped" banner; does not propagate to
   * the test-level status.
   */
  | 'skipped';

export type ReportOutcome = Outcome & {
  viewport: Viewport;
};

export interface TestResult {
  id: string;
  name: string;
  filePath: string;
  startingPath: string;
  controlUrl: string;
  experimentUrl: string;
  code: string | null;
  chips: ChipDescriptor[];
  /**
   * Per-test sort-dimension values (one per metric the pipeline exposes for
   * sorting). Drives the report shell's "Sort by" chips; empty for tests with
   * nothing sortable (e.g. failed tests).
   */
  sorts: SortDescriptor[];
  durationMs: number;
  /**
   * Epoch-ms timestamp of the freshest per-test artifact file on disk
   * (across perf + visreg, across viewports). Null when nothing was
   * measured for this test — typically because it's a shard that didn't
   * include it, or because `--report-only` was run against a tree missing
   * this test's directory. Rendered as "updated N d H h ago" on each card
   * so stale measurements are visible at a glance in merged reports.
   */
  measuredAt: number | null;
  runId: string | null;
  outcomes: ReportOutcome[];
  /**
   * Absolute on-disk artifact directory for each viewport this test could
   * produce work in. Useful for jumping straight to screenshots, traces,
   * raw outcome JSON, etc. from the report shell.
   */
  viewportArtifactPaths: { viewport: string; path: string }[];
}

export interface ReportMeta {
  title: string;
  pipelineName?: string;
  generatedAt: string;
  controlUrl: string;
  experimentUrl: string;
  durationMs: number;
  cwd: string;
  /**
   * Engine-level (cross-cutting) errors to show as a banner at the top
   * of the report. Per-test / per-stage errors go on the framework Outcome.
   */
  errors: string[];
  /**
   * Set when this report was produced by `shaka-perf compare --report-only`,
   * i.e. rebuilt from existing artifacts without re-running engines.
   */
  reportOnly: boolean;
  pipelineConfig: unknown;
  /**
   * Which variant of the report this HTML file is. `writeReport` emits two
   * files per run — `full-report.html` (mode `'full'`) for local devs and
   * `self-contained-performance-report.html` (mode `'self-contained'`) for
   * sharing — and the shell uses
   * this flag at render time to gate `<FullReportOnly/>` content.
   */
  reportMode: ReportMode;
}

export interface ReportData {
  meta: ReportMeta;
  tests: TestResult[];
}

const DATA_TAG_OPEN = '<script id="__shaka_report_data__" type="application/json">';
const DATA_TAG_CLOSE = '</script>';
const TITLE_TAG = /<title>[^<]*<\/title>/;

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Bake the pipeline name into the static <title> so the browser tab reads
// "shaka-perf · audit" from first paint — no runtime override (which flickered
// from the template default "compare" to the real name on React mount).
function applyTitle(html: string, pipelineName: string | undefined): string {
  const title = `shaka-perf · ${escapeForHtml(pipelineName ?? 'compare')}`;
  return html.replace(TITLE_TAG, `<title>${title}</title>`);
}

function locateTemplate(): string {
  // After tsc + copy-assets, the template lives at <pkg>/dist/report-shell/index.html.
  // During dev (no copy-assets yet), fall back to the Vite output directly.
  const candidates = [
    path.resolve(__dirname, '..', 'report-shell', 'index.html'),
    path.resolve(__dirname, '..', '..', 'report-shell', 'dist', 'index.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `report-shell HTML template not found. Run \`vite build\` in packages/shaka-perf/report-shell first. Tried:\n${candidates.join('\n')}`,
  );
}

function escapeForScript(json: string): string {
  // Prevent </script> in payload from terminating the inline script.
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

function logPayloadBreakdown(data: ReportData): void {
  const tests = data.tests ?? [];
  const sizes = tests.map((t) => {
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(t), 'utf8');
    } catch {
      bytes = -1;
    }
    return { name: t.name, bytes };
  });
  const total = sizes.reduce((s, t) => s + Math.max(0, t.bytes), 0);
  const top = [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  const fmt = (b: number) => (b < 0 ? '?MB (stringify failed)' : `${(b / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    payload total ~${fmt(total)} across ${tests.length} test(s)`);
  console.log(`    top ${top.length} contributors:`);
  for (const t of top) {
    console.log(`      ${fmt(t.bytes).padStart(10, ' ')}  ${t.name}`);
  }
}

export function renderReportHtml(data: ReportData): string {
  const templatePath = locateTemplate();
  const template = fs.readFileSync(templatePath, 'utf8');

  const start = template.indexOf(DATA_TAG_OPEN);
  if (start < 0) {
    throw new Error(`report-shell template missing data placeholder: ${templatePath}`);
  }
  const end = template.indexOf(DATA_TAG_CLOSE, start + DATA_TAG_OPEN.length);
  if (end < 0) {
    throw new Error(`report-shell template malformed near data placeholder: ${templatePath}`);
  }

  logPayloadBreakdown(data);

  let payload: string;
  try {
    payload = escapeForScript(JSON.stringify(data));
  } catch (err) {
    if (err instanceof RangeError) {
      throw new Error(
        `Report payload exceeds V8's ~512 MB string limit — see "top contributors" above. ` +
        `Reduce by lowering image quality or frame counts. (${err.message})`,
      );
    }
    throw err;
  }
  const withData =
    template.slice(0, start + DATA_TAG_OPEN.length) +
    payload +
    template.slice(end);
  return applyTitle(withData, data.meta.pipelineName);
}

export interface WriteReportResult {
  /** Local-dev report; references sibling artifact files via relative paths. */
  fullPath: string;
  /**
   * Shareable, fully self-contained report — every persisted artifact path is
   * replaced with a base64 data URI so the file works without sibling files.
   */
  selfContainedPath: string;
}

/** Local-dev report variant; references sibling artifact files via relative paths. */
export const FULL_REPORT_FILENAME = 'full-report.html';
/** Shareable variant; every artifact inlined as a base64 data URI, works standalone. */
export const SELF_CONTAINED_REPORT_FILENAME = 'self-contained-performance-report.html';

export async function writeReport(
  data: ReportData,
  outDir: string,
  stages: readonly Stage[] = [],
): Promise<WriteReportResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const fullData = reportDataForMode(
    { ...data, meta: { ...data.meta, reportMode: 'full' } },
    'full',
    stages,
    outDir,
  );
  const selfContainedInput = {
    ...data,
    meta: { ...data.meta, reportMode: 'self-contained' as const },
  };
  const artifactDictionary = await buildSelfContainedArtifactDictionary(
    selfContainedInput,
    stages,
    outDir,
  );
  const selfContainedData = reportDataForMode(
    selfContainedInput,
    'self-contained',
    stages,
    outDir,
    artifactDictionary,
  );
  const fullPath = path.join(outDir, FULL_REPORT_FILENAME);
  const selfContainedPath = path.join(
    outDir,
    SELF_CONTAINED_REPORT_FILENAME,
  );
  fs.writeFileSync(fullPath, renderReportHtml(fullData));
  fs.writeFileSync(
    selfContainedPath,
    renderReportHtml(selfContainedData),
  );
  return { fullPath, selfContainedPath };
}

/**
 * Project each measurement to its report-facing shape. Full reports retain
 * artifact paths; self-contained reports recursively replace those paths with
 * data URIs.
 */
export function reportDataForMode<T extends ReportData>(
  data: T,
  mode: ReportMode,
  stages: readonly Stage[],
  resultsRoot: string,
  artifactDictionary?: Readonly<Record<string, string>>,
): T {
  const selfContainedStrips = new Map(
    stages.map((stage) => [stage.name, stage.selfContainedReportStrip]),
  );
  const shouldStrip = mode === 'self-contained' &&
    selfContainedStrips.size > 0;
  const stripped = !shouldStrip ? data : {
    ...data,
    tests: data.tests.map((test) => ({
      ...test,
      outcomes: test.outcomes.map((outcome) => {
        if (outcome.kind !== 'ok' || outcome.measurement == null) return outcome;
        const strip = selfContainedStrips.get(outcome.stage);
        if (!strip) return outcome;
        return {
          ...outcome,
          measurement: applySelfContainedReportStrip(
            outcome.measurement,
            strip,
          ),
        };
      }),
    })),
  } as T;
  return mode === 'self-contained'
    ? inlineArtifactPaths(stripped, resultsRoot, artifactDictionary) as T
    : stripped;
}

function applySelfContainedReportStrip(
  value: unknown,
  strip: SelfContainedReportStrip,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === 'object'
        ? applySelfContainedReportStrip(item, strip)
        : item);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const rule = strip[key];
      if (rule === true) return [];
      if (rule && typeof rule === 'object') {
        return [[key, applySelfContainedReportStrip(item, rule)]];
      }
      return [[key, item]];
    }),
  );
}

function inlineArtifactPaths(
  value: unknown,
  resultsRoot: string,
  artifactDictionary?: Readonly<Record<string, string>>,
): unknown {
  if (typeof value === 'string') {
    if (artifactDictionary) {
      return Object.prototype.hasOwnProperty.call(artifactDictionary, value)
        ? artifactDictionary[value]
        : value;
    }
    const absolutePath = path.resolve(resultsRoot, value);
    const relativePath = path.relative(resultsRoot, absolutePath);
    if (
      relativePath === '' ||
      path.isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      return value;
    }
    try {
      if (!fs.statSync(absolutePath).isFile()) return value;
      const bytes = fs.readFileSync(absolutePath);
      return `data:${mimeTypeForArtifactPath(absolutePath)};base64,${
        bytes.toString('base64')
      }`;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      inlineArtifactPaths(item, resultsRoot, artifactDictionary));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        inlineArtifactPaths(item, resultsRoot, artifactDictionary),
      ]),
    );
  }
  return value;
}

const HEIF_MAX_DIMENSION = 16_384;
const SVG_IMAGE_DATA_URI_RE =
  /data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+=*/g;

/**
 * Build the exact path→data-URI dictionary used by the self-contained report.
 * Stage strip dictionaries remove local-only fields first; this function
 * centrally encodes every artifact path that survives.
 */
export async function buildSelfContainedArtifactDictionary(
  data: ReportData,
  stages: readonly Stage[],
  resultsRoot: string,
): Promise<Record<string, string>> {
  const projected = reportDataForMode(
    data,
    'self-contained',
    stages,
    resultsRoot,
    {},
  );
  const artifactPaths = new Set<string>();
  collectArtifactPaths(projected, resultsRoot, artifactPaths);

  const encoded = await Promise.all(
    [...artifactPaths].map(async (artifactPath) => [
      artifactPath,
      await encodeArtifact(artifactPath, resultsRoot),
    ] as const),
  );
  return Object.fromEntries(encoded);
}

function collectArtifactPaths(
  value: unknown,
  resultsRoot: string,
  artifactPaths: Set<string>,
): void {
  if (typeof value === 'string') {
    if (resolveArtifactPath(value, resultsRoot)) artifactPaths.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactPaths(item, resultsRoot, artifactPaths);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectArtifactPaths(item, resultsRoot, artifactPaths);
    }
  }
}

async function encodeArtifact(
  artifactPath: string,
  resultsRoot: string,
): Promise<string> {
  const absolutePath = resolveArtifactPath(artifactPath, resultsRoot);
  if (!absolutePath) return artifactPath;
  const raw = (): string => {
    const bytes = fs.readFileSync(absolutePath);
    return `data:${mimeTypeForArtifactPath(absolutePath)};base64,${
      bytes.toString('base64')
    }`;
  };
  try {
    if (isRasterImage(absolutePath)) {
      const bytes = await encodeAvif(absolutePath);
      return `data:image/avif;base64,${bytes.toString('base64')}`;
    }
    if (
      path.extname(absolutePath).toLowerCase() === '.svg'
    ) {
      const svg = await compressSvgEmbeddedImages(
        fs.readFileSync(absolutePath, 'utf8'),
      );
      return `data:image/svg+xml;base64,${
        Buffer.from(svg).toString('base64')
      }`;
    }
    return raw();
  } catch (error) {
    console.warn(
      `[shaka-perf report] failed to compress ${artifactPath}; ` +
      `using original bytes: ${(error as Error).message}`,
    );
    return raw();
  }
}

function resolveArtifactPath(
  artifactPath: string,
  resultsRoot: string,
): string | undefined {
  const absolutePath = path.resolve(resultsRoot, artifactPath);
  const relativePath = path.relative(resultsRoot, absolutePath);
  if (
    relativePath === '' ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    return undefined;
  }
  try {
    return fs.statSync(absolutePath).isFile() ? absolutePath : undefined;
  } catch {
    return undefined;
  }
}

function isRasterImage(filePath: string): boolean {
  return /\.(?:png|jpe?g|webp|avif)$/i.test(filePath);
}

async function encodeAvif(
  filePath: string,
): Promise<Buffer> {
  const metadata = await sharp(filePath).metadata();
  const sourceWidth = metadata.width;
  let targetWidth = sourceWidth ?? HEIF_MAX_DIMENSION;
  targetWidth = Math.min(targetWidth, 960);
  targetWidth = Math.min(targetWidth, HEIF_MAX_DIMENSION);
  return sharp(filePath)
    .resize({
      width: targetWidth,
      height: HEIF_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .avif({ quality: 45, effort: 2 })
    .toBuffer();
}

async function compressSvgEmbeddedImages(
  svg: string,
): Promise<string> {
  const matches = [...svg.matchAll(SVG_IMAGE_DATA_URI_RE)];
  const replacements = await Promise.all(matches.map(async (match) => {
    const original = match[0];
    const base64 = original.slice(
      original.indexOf('base64,') + 'base64,'.length,
    );
    const output = await sharp(Buffer.from(base64, 'base64'))
      .resize({ width: 160, withoutEnlargement: true })
      .webp({ quality: 40 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
  }));
  let output = svg;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    output = output.slice(0, match.index!) +
      replacements[index] +
      output.slice(match.index! + match[0].length);
  }
  return output;
}

class ReportSummaryLogger implements StageLogger {
  log(): void {}
  flush(): string {
    return '';
  }
}

export function writeMachineReport(
  reportPath: string,
  tests: AbTestDefinition[],
  viewportsByTest: (test: AbTestDefinition) => Viewport[],
  pipeline: Pipeline,
  meta: ReportMeta,
  store: ArtifactStore,
  runtime: StageRuntime,
  chipsByTest: ReadonlyMap<AbTestDefinition, readonly ChipDescriptor[]>,
  config: AbTestsConfig,
): void {
  const stagesByName = new Map<StageName, Stage>(
    pipeline.stages.map((stage) => [stage.name, stage]),
  );
  const rows = tests.flatMap((test) => viewportsByTest(test).map((viewport) => ({
    test,
    viewport,
    // Same stale-outcome guard as the HTML report (see buildTestPartial).
    outcomes: store.readOutcomesForViewport(test, viewport.label)
      .filter((outcome) =>
        persistedOutcomeInScope(test, config, stagesByName.get(outcome.stage), outcome, viewport.label)),
  })));
  const machineReportMeta = pipeline.machineReportMeta?.({
    rows,
    reportOnly: meta.reportOnly,
  }) ?? {};
  const payload = {
    schemaVersion: 1,
    meta: {
      generatedAt: meta.generatedAt,
      pipelineName: meta.pipelineName,
      durationMs: meta.durationMs,
      ...machineReportMeta,
      cwd: meta.cwd,
      controlUrl: meta.controlUrl,
      experimentUrl: meta.experimentUrl,
      reportHtml: 'self-contained-performance-report.html',
      reportOnly: meta.reportOnly,
      errors: meta.errors,
    },
    pipeline: {
      name: pipeline.name,
      stages: pipeline.stages.map((stage) => stage.name),
    },
    // Chips are per-test (not per-viewport), but `tests` here flattens to a
    // (test, viewport) row per entry — so the same chip array rides every
    // row that shares a test. Lossless and trivially groupable downstream,
    // and the duplication is small next to the outcome payload.
    tests: rows.map(({ test, viewport, outcomes }) => ({
      id: path.basename(store.unitDirForViewport(test, viewport.label)),
      name: test.name,
      filePath: test.file,
      startingPath: test.startingPath,
      viewport: {
        label: viewport.label,
        width: viewport.width,
        height: viewport.height,
      },
      chips: chipsByTest.get(test) ?? [],
      outcomes: outcomes.map((outcome) => ({
        kind: outcome.kind,
        stage: outcome.stage,
        error: outcome.error,
        reason: outcome.reason,
        logs: outcome.logs,
        summary: machineSummaryForOutcome(stagesByName, outcome, {
          test,
          viewport,
          artifacts: store.scopeFor(test, viewport.label),
          logger: new ReportSummaryLogger(),
          priorOutcomes: new Map(),
          runtime,
          controlURL: resolveUrl(
            test.startingPath,
            test.config?.shared?.controlURL ?? meta.controlUrl,
          ),
          experimentURL: resolveUrl(
            test.experimentPathOverride ?? test.startingPath,
            test.config?.shared?.experimentURL ?? meta.experimentUrl,
          ),
        }),
      })),
    })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
}

function machineSummaryForOutcome(
  stagesByName: ReadonlyMap<StageName, Stage>,
  outcome: Outcome,
  ctx: StageRenderContext,
): unknown {
  if (outcome.kind !== 'ok' || outcome.measurement == null) return undefined;
  const stage = stagesByName.get(outcome.stage);
  if (!stage) return undefined;
  return stage.machineReadableSummary(outcome.measurement, ctx);
}
