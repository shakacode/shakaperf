/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCoverageMap, createFileCoverage, type CoverageMap, type FileCoverageData } from 'istanbul-lib-coverage';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { createContext } from 'istanbul-lib-report';
import { createSourceMapStore } from 'istanbul-lib-source-maps';
import { create as createReport } from 'istanbul-reports';
import type { CodeCoverageConfigInput } from 'shaka-shared';
import type { TestResult } from '../../../pipeline/report';
import { nycCoverageFileName } from './coverage-artifacts';
import { coverageScope, digest, originalSource, sourceHash, type CoverageScope } from './source-scope';
import type { CodeCoverageResult } from './stage';

interface Contributor { test: string; viewport: string; run: string; artifact: string; build?: string }
export interface CumulativeCoverageReport {
  href: string;
  incomplete: boolean;
  scope: { projectRoot: string; include: string[] | null; exclude: string[] };
  scopes: { projectRoot: string; include: string[] | null; exclude: string[]; tests: string[] }[];
  contributors: Contributor[];
  diagnostics: string[];
  failures: string[];
  summary: ReturnType<CoverageMap['getCoverageSummary']>['data'];
}

export interface CumulativeCoverageOptions {
  resultsRoot: string;
  configPath?: string;
  config?: CodeCoverageConfigInput;
  tests: readonly TestResult[];
  testConfigs?: ReadonlyMap<string, CodeCoverageConfigInput | undefined>;
  viewports?: readonly string[];
  engineFailures?: string[];
}

/** All aggregation uses Istanbul's location-based union and hit sums, never percentages. */
export async function generateCumulativeCoverageReport(options: CumulativeCoverageOptions): Promise<CumulativeCoverageReport> {
  const defaultScope = coverageScope(options.config, options.configPath);
  const scopeByTest = new Map(options.tests.map((test) => [test.id,
    options.testConfigs?.has(test.id)
      ? coverageScope(options.testConfigs.get(test.id), options.configPath) : defaultScope,
  ]));
  const distinctScopes = new Map<string, { scope: CoverageScope; tests: string[] }>();
  for (const test of options.tests) {
    const scope = scopeByTest.get(test.id)!;
    const key = scope.root + '\0' + scope.identity;
    if (!distinctScopes.has(key)) distinctScopes.set(key, { scope, tests: [] });
    distinctScopes.get(key)!.tests.push(test.name);
  }
  if (!distinctScopes.size) distinctScopes.set('default', { scope: defaultScope, tests: [] });
  const scopes = [...distinctScopes.values()];
  const scope = scopes[0]!.scope;
  const map = createCoverageMap({});
  const diagnostics: string[] = [];
  const failures = [...(options.engineFailures ?? [])];
  const contributors: Contributor[] = [];
  let buildRevision: string | undefined;
  const signatures = new Map<string, string>();
  const identities = new Map<string, string>();
  const blocked = new Set<string>();
  const reportDir = path.join(options.resultsRoot, 'coverage');
  // A failed regeneration must never leave a previous successful HTML report behind.
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });
  const add = (data: FileCoverageData, scope: CoverageScope) => {
    if (!scope.includes(data.path) || blocked.has(data.path)) return;
    validateLocations(data);
    const signature = coverageShape(data);
    const previous = signatures.get(data.path);
    const identity = instrumentationIdentity(data);
    const previousIdentity = identities.get(data.path);
    if ((previous && previous !== signature) || (identity && previousIdentity && identity !== previousIdentity)) {
      diagnostics.push(`${scope.relative(data.path)}: incompatible instrumentation locations; excluded from aggregate.`);
      blocked.add(data.path);
      map.filter((filename) => filename !== data.path);
      return;
    }
    signatures.set(data.path, signature);
    if (identity) identities.set(data.path, identity);
    map.addFileCoverage(data);
  };

  for (const test of options.tests) {
    const scope = scopeByTest.get(test.id)!;
    for (const outcome of test.outcomes) {
      if (outcome.stage !== 'code_coverage' || outcome.outsideCurrentConfig
        || (options.viewports && !options.viewports.includes(outcome.viewport.label))) continue;
      const label = `${test.name} [${outcome.viewport.label}]`;
      if (outcome.kind === 'error') {
        failures.push(`${label}: ${outcome.error?.message ?? 'coverage failed'}`);
        continue;
      }
      if (outcome.kind !== 'ok') continue;
      try {
        const build = outcome.runMetadata?.targets.find((target) => target.side === 'experiment')?.commit?.sha;
        if (build && buildRevision && build !== buildRevision) throw new Error(`measured build revision ${build} conflicts with contributing revision ${buildRevision}; remeasure one source revision`);
        const measurement = outcome.measurement as CodeCoverageResult;
        const provenance = measurement.provenance;
        if (!provenance || provenance.version !== 1) throw new Error('saved coverage has no source provenance; rerun this test');
        if (provenance.scope !== scope.identity) throw new Error('source scope/instrumenter changed; rerun this test');
        if (provenance.testHash && sourceHash(test.filePath) !== provenance.testHash) throw new Error('test source changed; rerun this test');
        const artifact = measurement.coverageHref;
        if (!artifact) throw new Error('coverage artifact missing');
        const filename = path.resolve(options.resultsRoot, artifact);
        if (!filename.startsWith(path.resolve(options.resultsRoot) + path.sep)) throw new Error('coverage artifact is outside results directory');
        // Outcome owns membership; orphan .nyc_output files never select themselves.
        const mirror = path.join(options.resultsRoot, '.nyc_output', nycCoverageFileName(path.basename(path.dirname(path.dirname(filename)))));
        const raw = JSON.parse(fs.readFileSync(fs.existsSync(mirror) ? mirror : filename, 'utf8'));
        if (digest(JSON.stringify(raw)) !== provenance.coverageHash) throw new Error('saved coverage artifact changed or mirror is stale; rerun this test');
        for (const [relative, hash] of Object.entries(provenance.sources)) {
          if (sourceHash(path.resolve(scope.root, relative)) !== hash) throw new Error(`source revision changed (${relative}); rerun this test`);
        }
        for (const missing of provenance.missing) diagnostics.push(`${label}: source unavailable: ${missing}; configure pathMappings or restore sources.`);
        for (const [source, data] of Object.entries(raw)) {
          try {
            const normalized = await normalizeCoverage({ [source]: data as FileCoverageData }, scope);
            for (const file of normalized.files()) {
              if (!scope.include && !scope.includes(file) && !scope.excludes(file)) {
                diagnostics.push(`${label}: ${file}: source is outside projectRoot; configure pathMappings or projectRoot. Excluded.`);
              }
              add(normalized.fileCoverageFor(file).data, scope);
            }
          } catch (error) {
            diagnostics.push(`${label}: ${source}: ${message(error)}; excluded.`);
          }
        }
        if (build) buildRevision ??= build;
        contributors.push({ test: test.name, viewport: outcome.viewport.label,
          run: outcome.runId ?? 'unknown', artifact, ...(build ? { build } : {}) });
      } catch (error) {
        diagnostics.push(`${label}: ${message(error)}.`);
      }
    }
  }

  for (const { scope } of scopes) {
    let eligible: string[] = [];
    try { eligible = scope.files(); }
    catch (error) { diagnostics.push(`Cannot enumerate source scope: ${message(error)}`); }
    if (scope.include && !eligible.length) diagnostics.push('Configured source scope matched no files. Check projectRoot and include patterns.');
    // Loaded-only mode has no enumerated denominator, but adapters must still
    // validate the files actually measured in that scope.
    const files = new Set([...eligible, ...map.files().filter(scope.includes)]);
    for (const filename of files) {
      if (blocked.has(filename)) continue;
      if (map.files().includes(filename)) {
        // A configured build adapter also verifies the served instrumentation against the current build.
        if (scope.instrument || (scope.include && /\.[cm]?jsx?$/.test(filename))) {
          try {
            const template = await instrumentFile(filename, scope);
            const measured = map.fileCoverageFor(filename).data;
            if (coverageShape(template) !== coverageShape(measured)
              || (instrumentationIdentity(template) && instrumentationIdentity(measured)
                && instrumentationIdentity(template) !== instrumentationIdentity(measured))) {
              throw new Error('served build instrumentation differs from the project instrumenter');
            }
          } catch (error) {
            diagnostics.push(`${scope.relative(filename)}: ${message(error)}; excluded.`);
            map.filter((file) => file !== filename);
            blocked.add(filename);
          }
        }
        continue;
      }
      try { add(await instrumentFile(filename, scope), scope); }
      catch (error) { diagnostics.push(`${scope.relative(filename)}: cannot analyze unvisited file: ${message(error)}`); }
    }
  }
  // Loaded-only mode must diagnose missing sources as well, before the HTML viewer reads them.
  for (const filename of map.files()) {
    try { fs.readFileSync(filename, 'utf8'); }
    catch {
      diagnostics.push(`${scope.relative(filename)}: source unavailable; configure pathMappings or restore sources. Excluded.`);
      map.filter((file) => file !== filename);
    }
  }
  if (contributors.length && !map.files().length && !diagnostics.length) diagnostics.push('Measured coverage contains no files in the effective source scope. Check include patterns and pathMappings.');
  if (!contributors.length) diagnostics.push('No compatible measured coverage. Instrument the served build and rerun --categories code_coverage.');
  const result: CumulativeCoverageReport = {
    href: 'coverage/index.html', incomplete: diagnostics.length > 0 || failures.length > 0,
    scope: { projectRoot: scope.root, include: scope.include ?? null, exclude: scope.exclude },
    scopes: scopes.map(({ scope, tests }) => ({ projectRoot: scope.root, include: scope.include ?? null, exclude: scope.exclude, tests })),
    contributors, diagnostics: [...new Set(diagnostics)], failures,
    summary: map.getCoverageSummary().data,
  };
  const context = createContext({ dir: reportDir, coverageMap: map, sourceFinder: (filename) => fs.readFileSync(filename, 'utf8') });
  createReport('html').execute(context);
  createReport('json', { file: 'coverage-final.json' }).execute(context);
  createReport('text-summary').execute(context);
  fs.writeFileSync(path.join(reportDir, 'scope.json'), JSON.stringify(result, null, 2));
  for (const filename of htmlFiles(reportDir)) {
    const html = fs.readFileSync(filename, 'utf8');
    fs.writeFileSync(filename, html.replace(/<body[^>]*>/, (body) => body + disclosure(result)));
  }
  for (const { scope, tests } of scopes) {
    console.log(`Coverage scope (${tests.join(', ') || 'no tests'}): ${scope.root} · ${scope.include?.join(', ') ?? 'loaded instrumented files only (not whole-project coverage)'}; exclusions: ${scope.exclude.join(', ')}`);
  }
  for (const diagnostic of result.diagnostics) console.warn(`Coverage incomplete: ${diagnostic}`);
  console.log(`Coverage report${result.incomplete ? ' (incomplete)' : ''}: ${path.join(reportDir, 'index.html')}`);
  return result;
}

async function instrumentFile(filename: string, scope: CoverageScope): Promise<FileCoverageData> {
  const source = fs.readFileSync(filename, 'utf8');
  let raw: unknown;
  if (scope.instrument) raw = await scope.instrument(source, filename);
  else {
    if (!/\.[cm]?jsx?$/.test(filename)) throw new Error('configure audit.codeCoverage.instrument with the project syntax/build transforms');
    const instrumenter = createInstrumenter({ esModules: true, parserPlugins: ['jsx'] });
    instrumenter.instrumentSync(source, filename);
    raw = instrumenter.lastFileCoverage();
  }
  const data = createFileCoverage(JSON.parse(JSON.stringify(raw)) as FileCoverageData).data;
  // Adapters may return measured or instrumenter-initial counters; neither is execution evidence.
  const coverage = createFileCoverage(data);
  coverage.resetHits();
  const normalized = await normalizeCoverage({ [filename]: coverage.data }, scope);
  if (normalized.files().length !== 1 || normalized.files()[0] !== filename) throw new Error('instrumenter must map back to exactly this source file');
  return normalized.fileCoverageFor(filename).data;
}

async function normalizeCoverage(raw: Record<string, FileCoverageData>, scope: CoverageScope): Promise<CoverageMap> {
  const normalized = createCoverageMap({});
  for (const [key, value] of Object.entries(raw)) {
    const data = JSON.parse(JSON.stringify(value));
    data.path = scope.resolve(data.path ?? key);
    if (data.inputSourceMap) {
      const sm = data.inputSourceMap;
      if (sm.version !== 3 || !Array.isArray(sm.sources) || typeof sm.mappings !== 'string') throw new Error(`invalid source map for ${key}`);
      sm.sources = sm.sources.map((source: string, index: number) => {
        const original = originalSource(scope, data.path, sm.sourceRoot, source);
        const content = sm.sourcesContent?.[index];
        if (scope.includes(original) && typeof content === 'string' && fs.existsSync(original) && digest(content) !== sourceHash(original)) {
          throw new Error(`source map contains a different source revision (${scope.relative(original)})`);
        }
        return original;
      });
      sm.sourceRoot = '';
    }
    if (!data.inputSourceMap) validateLocations(data);
    normalized.addFileCoverage(data);
  }
  const store = createSourceMapStore();
  try {
    const remapped = await store.transformCoverage(normalized);
    if (normalized.files().length && !remapped.files().length) throw new Error('source map produced no mapped code locations');
    return remapped;
  } finally { store.dispose(); }
}

/** Invalid generated locations cannot define a truthful source denominator. */
function validateLocations(data: FileCoverageData): void {
  const maps: [Record<string, unknown>, (value: any) => unknown][] = [
    [data.statementMap, (value) => value],
    [data.fnMap, (value) => value.loc],
    [data.branchMap, (value) => value.locations[0]],
  ];
  for (const [locations, location] of maps) {
    const seen = new Set<string>();
    for (const value of Object.values(locations)) {
      const loc = location(value) as { start?: { line?: number }; end?: { line?: number } };
      if (!loc?.start?.line || loc.start.line < 1 || !loc.end?.line || loc.end.line < 1) {
        throw new Error(`${data.path}: instrumentation contains unmapped/generated code locations; instrument before code-generating transforms or supply input source maps`);
      }
      const key = JSON.stringify(loc);
      if (seen.has(key)) throw new Error(`${data.path}: ambiguous duplicate code locations; instrument before code-generating transforms`);
      seen.add(key);
    }
  }
}

function instrumentationIdentity(data: FileCoverageData): string | undefined {
  const metadata = data as FileCoverageData & { hash?: string; _coverageSchema?: string };
  return typeof metadata.hash === 'string' && typeof metadata._coverageSchema === 'string'
    ? `${metadata._coverageSchema}:${metadata.hash}` : undefined;
}

/** Compare locations independently of counter ids and serialization order. */
export function coverageShape(data: FileCoverageData): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify([data.statementMap, data.fnMap, data.branchMap].map((locations) =>
    Object.values(locations).map((value) => JSON.stringify(canonical(value))).sort()));
}

function* htmlFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(filename);
    else if (entry.name.endsWith('.html')) yield filename;
  }
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
function disclosure(report: CumulativeCoverageReport): string {
  const list = (values: string[]) => `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
  return `<section style="padding:16px;border-bottom:2px solid #888" aria-label="Coverage scope"><h2>All Tests · executed-code coverage${report.incomplete ? ' · INCOMPLETE' : ''}</h2>`
    + report.scopes.map((scope) => `<p>${escape(scope.include ? 'Configured source scope: ' + scope.include.join(', ') : 'Loaded instrumented files only. This is not whole-project coverage.')}</p>`
      + `<p>Project root: ${escape(scope.projectRoot)} · Exclusions: ${escape(scope.exclude.join(', '))}</p>`
      + `<details><summary>Tests using this scope (${scope.tests.length})</summary>${list(scope.tests)}</details>`).join('')
    + '<p>Source fingerprints describe local files at collection. Serve the matching build; a project instrumenter and embedded source maps provide additional build checks.</p>'
    + '<p>Statement, branch, function and line counters are merged by source location. Screenshot visibility is measured separately in each test’s visibility map.</p>'
    + `<details><summary>Contributing tests and runs (${report.contributors.length})</summary>${list(report.contributors.map((c) => `${c.test} [${c.viewport}] · run ${c.run}${c.build ? ' · build ' + c.build : ''} · ${c.artifact}`))}</details>`
    + (report.diagnostics.length ? `<h3>Analysis diagnostics</h3>${list(report.diagnostics)}` : '')
    + (report.failures.length ? `<h3>Test / engine failures</h3>${list(report.failures)}` : '') + '</section>';
}
