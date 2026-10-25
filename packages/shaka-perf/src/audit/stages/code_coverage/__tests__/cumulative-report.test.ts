/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInstrumenter } from 'istanbul-lib-instrument';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import type { CodeCoverageConfigInput } from 'shaka-shared';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import type { TestResult } from '../../../../pipeline/report';
import { generateCumulativeCoverageReport } from '../cumulative-report';
import { coverageProvenance, coverageScope } from '../source-scope';
import { mirrorCoverageToNycOutput } from '../coverage-artifacts';

let root: string;
let resultsRoot: string;
let configPath: string;
let config: CodeCoverageConfigInput;
let tests: TestResult[];
const source = 'export function choose(flag) {\n if (flag) return 1;\n return 2;\n}\n';
function write(name: string, content = source) {
  const filename = path.join(root, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
  return filename;
}
function instrument(filename: string) {
  const tool = createInstrumenter({ esModules: true, parserPlugins: ['jsx'] });
  tool.instrumentSync(fs.readFileSync(filename, 'utf8'), filename);
  return JSON.parse(JSON.stringify(tool.lastFileCoverage())) as FileCoverageData;
}
function save(name: string, raw: Record<string, FileCoverageData>, phone = false) {
  const viewport = phone ? PHONE_VIEWPORT : DESKTOP_VIEWPORT;
  const dir = path.join(resultsRoot, name + '-' + viewport.label, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'coverage.json');
  fs.writeFileSync(filename, JSON.stringify(raw));
  mirrorCoverageToNycOutput(filename, resultsRoot, path.basename(path.dirname(dir)));
  const testFile = write(name + '.abtest.ts', '// test');
  const test = {
    id: name, name, filePath: testFile, outcomes: [{
      kind: 'ok', stage: 'code_coverage', viewport, runId: name + '-run',
      measurement: { coverageHref: path.relative(resultsRoot, filename),
        provenance: coverageProvenance(raw, coverageScope(config, configPath), testFile) },
    }],
  } as TestResult;
  tests.push(test);
  return test;
}
const generate = (overrides = {}) => generateCumulativeCoverageReport({ resultsRoot, configPath, config, tests, ...overrides });
const final = () => JSON.parse(fs.readFileSync(path.join(resultsRoot, 'coverage/coverage-final.json'), 'utf8')) as Record<string, FileCoverageData>;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-cumulative-'));
  resultsRoot = path.join(root, 'audit-results');
  configPath = path.join(root, 'abtests.config.ts');
  config = { include: ['src/**'], exclude: ['src/excluded.js'] };
  tests = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });

it('unions complementary hits, including reordered ids, and includes unvisited files at zero', async () => {
  const filename = write('src/choose.js');
  const unvisited = write('src/unvisited.js');
  write('src/excluded.js');
  const a = instrument(filename);
  const b = instrument(filename);
  const ids = Object.keys(a.s);
  a.s[ids[0]!] = 1;
  b.s[ids[1]!] = 1;
  // Location, not counter id, identifies the statement across measurements.
  b.statementMap['99'] = b.statementMap[ids[1]!]!;
  b.s['99'] = b.s[ids[1]!]!;
  delete b.statementMap[ids[1]!]; delete b.s[ids[1]!];
  save('first', { [filename]: a });
  const single = await generate();
  save('second', { [filename]: b }, true);
  const combined = await generate();
  expect(combined.summary.statements.covered).toBe(single.summary.statements.covered + 1);
  expect(combined.incomplete).toBe(false);
  expect(final()[unvisited]!.s).toEqual(instrument(unvisited).s);
  expect(Object.keys(final())).not.toContain(path.join(root, 'src/excluded.js'));
  expect(combined.contributors.map((c) => c.run)).toEqual(['first-run', 'second-run']);
});

it('zero-hit records merge when the same file is later exercised', async () => {
  const filename = write('src/later.js');
  const empty = await generate();
  const data = instrument(filename);
  for (const id of Object.keys(data.s)) data.s[id] = 1;
  save('later', { [filename]: data });
  const exercised = await generate();
  expect(exercised.summary.statements.total).toBe(empty.summary.statements.total);
  expect(exercised.summary.statements.pct).toBe(100);
});

it('discloses unsupported sources and missing instrumentation without inventing counters', async () => {
  write('src/page.tsx', 'export const Page = () => <h1>Hi</h1>;');
  write('src/template.vue', '<template>Hello</template>');
  const report = await generate();
  expect(report.incomplete).toBe(true);
  expect(report.diagnostics.join(' ')).toMatch(/page.tsx.*project syntax\/build transforms/);
  expect(report.diagnostics.join(' ')).toContain('template.vue');
  expect(report.diagnostics.join(' ')).toContain('No compatible measured coverage');
  expect(Object.keys(final())).toHaveLength(0);
  expect(fs.readFileSync(path.join(resultsRoot, report.href), 'utf8')).toContain('INCOMPLETE');
});

it('resolves nested configuration, project root and Docker source prefixes', async () => {
  configPath = path.join(root, 'tools/coverage/abtests.config.ts');
  config = { projectRoot: '../..', include: ['app/frontend/**'], pathMappings: { '/app': '.' } };
  const filename = write('app/frontend/a.js');
  const data = instrument(filename);
  data.path = '/app/app/frontend/a.js';
  save('docker', { [data.path]: data });
  expect((await generate()).incomplete).toBe(false);
  expect(Object.keys(final())).toEqual([filename]);
});

it('uses a project instrumenter for transformed TSX and validates measured compatibility', async () => {
  const filename = write('src/view.tsx', 'export const View = () => <h1>Hello</h1>;');
  config.instrument = (_source, name) => {
    const tool = createInstrumenter({ esModules: true, parserPlugins: ['jsx'] });
    tool.instrumentSync('export const View = () => <h1>Hello</h1>;', name);
    return tool.lastFileCoverage();
  };
  const data = await config.instrument('', filename) as FileCoverageData;
  const measured = JSON.parse(JSON.stringify(data));
  for (const id of Object.keys(measured.s)) measured.s[id] = 1;
  save('tsx', { [filename]: measured });
  const report = await generate();
  expect(report.incomplete).toBe(false);
  expect(report.summary.statements.pct).toBe(100);
  expect(fs.readFileSync(path.join(resultsRoot, 'coverage/view.tsx.html'), 'utf8')).toContain('Hello');
});

it('rejects stale source revisions, changed scope and changed test definitions', async () => {
  const filename = write('src/a.js');
  save('stale', { [filename]: instrument(filename) });
  fs.appendFileSync(filename, '// changed');
  expect((await generate()).diagnostics.join(' ')).toContain('source revision changed');
  config.exclude = ['src/other.js'];
  expect((await generate()).diagnostics.join(' ')).toContain('source scope/instrumenter changed');
  config.exclude = ['src/excluded.js'];
  write('stale.abtest.ts', '// different test');
  expect((await generate()).diagnostics.join(' ')).toContain('test source changed');
});

it('ignores orphan mirrors and limits contributors by viewport / supplied tests', async () => {
  const filename = write('src/a.js');
  const desktop = save('desktop', { [filename]: instrument(filename) });
  save('phone', { [filename]: instrument(filename) }, true);
  fs.writeFileSync(path.join(resultsRoot, '.nyc_output/orphan.json'), '{broken');
  const report = await generate({ viewports: [DESKTOP_VIEWPORT.label] });
  expect(report.contributors.map((c) => c.test)).toEqual(['desktop']);
  expect((await generate({ tests: [desktop] })).contributors).toHaveLength(1);
});

it('rejects corrupted mirrors, legacy records and incompatible location maps', async () => {
  const filename = write('src/a.js');
  const first = save('first', { [filename]: instrument(filename) });
  const data = instrument(filename);
  data.statementMap['0']!.start.column += 1;
  save('second', { [filename]: data });
  const report = await generate();
  expect(report.diagnostics.join(' ')).toContain('incompatible instrumentation');
  expect(final()[filename]).toBeUndefined();
  delete (first.outcomes[0]!.measurement as { provenance?: unknown }).provenance;
  expect((await generate()).diagnostics.join(' ')).toContain('no source provenance');
  fs.writeFileSync(path.join(resultsRoot, '.nyc_output/second-desktop.json'), '{}');
  expect((await generate()).diagnostics.join(' ')).toContain('mirror is stale');
});

it('regenerates from saved results after a failed test and keeps failure diagnostics separate', async () => {
  const filename = write('src/a.js');
  save('pass', { [filename]: instrument(filename) });
  const failed = save('fail', { [filename]: instrument(filename) });
  failed.outcomes[0] = { kind: 'error', stage: 'code_coverage', viewport: PHONE_VIEWPORT, error: { message: 'test threw' } };
  const before = fs.readFileSync(path.join(resultsRoot, '.nyc_output/pass-desktop.json'));
  const report = await generate();
  expect(report.incomplete).toBe(true);
  expect(report.failures).toEqual(['fail [phone]: test threw']);
  expect(report.diagnostics).toEqual([]);
  expect(report.contributors).toHaveLength(1);
  expect(fs.readFileSync(path.join(resultsRoot, '.nyc_output/pass-desktop.json'))).toEqual(before);
  expect((await generate()).summary).toEqual(report.summary);
});

it('remaps transpiled coverage to original TypeScript and rejects stale embedded source', async () => {
  const ts = await import('typescript');
  const original = write('src/typed.ts', 'export const value: number = 1;\nexport function run(flag: boolean): number { return flag ? value : 0; }\n');
  const generated = path.join(root, 'build/typed.js');
  const compiled = ts.transpileModule(fs.readFileSync(original, 'utf8'), {
    fileName: original,
    compilerOptions: { sourceMap: true, inlineSources: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  const tool = createInstrumenter({ esModules: true });
  const sourceMap = JSON.parse(compiled.sourceMapText!);
  sourceMap.sources = [original];
  tool.instrumentSync(compiled.outputText, generated, sourceMap);
  const data = tool.lastFileCoverage() as FileCoverageData;
  for (const key of Object.keys(data.s)) data.s[key] = 1;
  config.instrument = () => data;
  save('mapped', { [generated]: data });
  expect((await generate()).incomplete).toBe(false);
  expect(Object.keys(final())).toEqual([original]);
  expect(fs.readFileSync(path.join(resultsRoot, 'coverage/typed.ts.html'), 'utf8')).toContain('number');
  // Keep local-source provenance valid but make the actual served source map disagree.
  const raw = JSON.parse(JSON.stringify(data));
  raw.inputSourceMap.sourcesContent[0] = 'export const stale = true;';
  tests = [];
  save('stale-map', { [generated]: raw });
  expect((await generate()).diagnostics.join(' ')).toContain('source map contains a different source revision');
});

it('discloses unavailable sources and project instrumenters that cannot reproduce measured maps', async () => {
  const filename = write('src/a.js');
  const data = instrument(filename);
  save('gone', { [filename]: data });
  fs.unlinkSync(filename);
  expect((await generate()).diagnostics.join(' ')).toMatch(/ENOENT|unavailable/);
  write('src/a.js');
  config.instrument = (_source, name) => {
    const record = instrument(name);
    record.statementMap['0']!.start.line += 1;
    return record;
  };
  tests = [];
  save('wrong-build', { [filename]: data });
  expect((await generate()).diagnostics.join(' ')).toContain('served build instrumentation differs');
  expect(final()[filename]).toBeUndefined();
});

it('diagnoses unmapped generated locations while preserving other files from the same test', async () => {
  const good = write('src/good.js');
  const broken = write('src/generated.js');
  const invalid = instrument(broken);
  invalid.statementMap['0']!.start.line = 0;
  save('mixed', { [good]: instrument(good), [broken]: invalid });
  const report = await generate();
  expect(report.incomplete).toBe(true);
  expect(report.diagnostics.join(' ')).toContain('unmapped/generated code locations');
  expect(final()[good]).toBeDefined();
});

it('accepts fresh per-test source overrides and discloses their distinct effective scopes', async () => {
  const filename = write('src/a.js');
  write('src/b.js');
  const base = config;
  const first = save('default-scope', { [filename]: instrument(filename) });
  config = { ...base, exclude: ['src/b.js'] };
  const second = save('test-override', { [filename]: instrument(filename) });
  const override = config;
  config = base;
  const report = await generate({ testConfigs: new Map([[first.id, base], [second.id, override]]) });
  expect(report.incomplete).toBe(false);
  expect(report.contributors.map((entry) => entry.test)).toEqual(['default-scope', 'test-override']);
  expect(report).toEqual(expect.objectContaining({ scopes: [
    expect.objectContaining({ tests: ['default-scope'], exclude: expect.arrayContaining(['src/excluded.js']) }),
    expect.objectContaining({ tests: ['test-override'], exclude: expect.arrayContaining(['src/b.js']) }),
  ] }));
});

it('discloses unresolved Docker sources in loaded-only mode alongside available files', async () => {
  config = {};
  const filename = write('src/a.js');
  const unavailable = instrument(filename);
  unavailable.path = '/missing-container-root/src/a.js';
  save('unmapped', { [filename]: instrument(filename), [unavailable.path]: unavailable });
  const report = await generate();
  expect(report.diagnostics.join(' ')).toContain('source is outside projectRoot');
  expect(final()[filename]).toBeDefined();
});

it('rejects retained measurements advertising a different served build revision', async () => {
  const filename = write('src/a.js');
  const first = save('old-build', { [filename]: instrument(filename) });
  const second = save('new-build', { [filename]: instrument(filename) });
  first.outcomes[0]!.runMetadata = { targets: [{ side: 'experiment', commit: { sha: 'aaaa' } }] } as never;
  second.outcomes[0]!.runMetadata = { targets: [{ side: 'experiment', commit: { sha: 'bbbb' } }] } as never;
  const report = await generate();
  expect(report.incomplete).toBe(true);
  expect(report.contributors.map((entry) => entry.test)).toEqual(['old-build']);
  expect(report.diagnostics.join(' ')).toContain('build revision bbbb conflicts');
});

it('validates a supplied project adapter in loaded-only reports', async () => {
  const filename = write('src/a.js');
  const data = instrument(filename);
  config = { instrument: () => {
    const wrongBuild = structuredClone(data);
    wrongBuild.statementMap['0']!.start.column += 1;
    return wrongBuild;
  } };
  save('loaded-only', { [filename]: data });
  const report = await generate();
  expect(report.diagnostics.join(' ')).toContain('served build instrumentation differs');
  expect(final()[filename]).toBeUndefined();
});

it('rejects an adapter record for a different source instead of relabeling its counters', async () => {
  const first = write('src/a.js');
  const second = write('src/b.js', 'export const completelyDifferent = 42;');
  config.instrument = () => instrument(first);
  save('adapter-cache', { [first]: instrument(first) });
  const report = await generate();
  expect(report.diagnostics.join(' ')).toContain('instrumenter must map back to exactly this source file');
  expect(final()[second]).toBeUndefined();
  expect(final()[first]).toBeDefined();
});

it('rejects differing served instrumentation hashes even when locations are unchanged', async () => {
  const filename = write('src/a.js');
  const data = { ...instrument(filename), hash: 'served-revision', _coverageSchema: 'same-instrumenter' };
  config = { instrument: () => ({ ...data, hash: 'current-revision' }) };
  save('stale-served-code', { [filename]: data });
  expect((await generate()).diagnostics.join(' ')).toContain('served build instrumentation differs');
});
