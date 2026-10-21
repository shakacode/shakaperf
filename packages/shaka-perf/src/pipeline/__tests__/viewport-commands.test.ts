/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AbTestDefinition } from 'shaka-shared';
import { buildAbTestsConfig } from '../../config';
import { loadAbTestsConfig, loadTests } from '../../config-loader';
import { createCompareCommand } from '../../compare/cli/program';
import { createAuditCommand } from '../../audit/program';
import { createPipeline } from '../pipeline';
import { ArtifactStore } from '../artifact-store';
import { runPipeline } from '../runner';
import type { TestContext, StageCategory } from '../../stage/stage';

// These stages do no browser measurement and must not contend with real runs.
jest.mock('../measurement-lock', () => ({
  acquireMeasurementLock: async () => ({ release: () => {} }),
}));
jest.mock('../../config-loader', () => ({
  ...jest.requireActual('../../config-loader'),
  loadAbTestsConfig: jest.fn(),
  loadTests: jest.fn(),
}));
jest.mock('../../compare/compare-pipeline', () => ({
  comparePipelineMetadata: { description: 'Compare', categories: ['visreg', 'perf'], stages: ['visreg', 'perf'] },
  comparePipelineConfigFromAbTests: jest.fn(),
  createComparePipeline: () => mockPipeline('compare'),
}));
jest.mock('../../audit/pipeline', () => ({
  auditPipelineMetadata: { description: 'Audit', categories: ['audit', 'accessibility'], defaultCategories: ['audit', 'accessibility'], stages: ['audit', 'accessibility'] },
  createAuditPipeline: () => mockPipeline('audit'),
}));

const measured: string[] = [];
function mockPipeline(name: 'compare' | 'audit') {
  const categories: StageCategory[] = name === 'compare' ? ['visreg', 'perf'] : ['audit', 'accessibility'];
  return createPipeline({
    name, description: name,
    derivedResultsDirs: ['derived'],
    report: { reportLabel: name, renderHeaderUrls: () => null, renderTestCardUrls: () => null, renderDialogMetaUrls: () => null },
  }, (builder) => {
    const pool = builder.registerWorkerPool(1);
    for (const category of categories) {
      builder.runStage(pool, {
        name: category, category, label: category, description: category,
        selfContainedReportStrip: {}, applies: () => true,
        run: async (ctx: TestContext) => {
          measured.push(`${ctx.test.name}:${ctx.viewport.label}:${category}`);
          await ctx.artifacts.writeFile('sample.txt', 'new');
          return {};
        },
        renderArtifacts: () => null, machineReadableSummary: () => ({}),
      });
    }
    builder.waitForAllTasksFinishAndDispose(pool);
    builder.buildChips({ chipsForAllTests: (tests) => new Map(tests.map(({ test }) => [test, []])) });
    builder.buildSorts({ sortsForAllTests: () => new Map() });
  });
}

const definition = (name: string, viewports?: string[]): AbTestDefinition => ({
  name, file: '/tests/product.abtest.ts', line: 1, startingPath: '/', testTypes: null,
  testFn: async () => {},
  ...(viewports ? { config: { shared: { viewports } } } : {}),
} as AbTestDefinition);

const config = {
  shared: {
    controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031',
    parallelism: 1, viewports: ['desktop', 'phone'],
    playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
    browserConsole: { failOn: [], allowList: [] },
  },
};

// Exercise both real command actions and the real runner/store/report boundary.
// Only expensive engines and discovery/config IO are replaced.
describe.each(['compare', 'audit'] as const)('%s --viewport', (command) => {
  let cwd: string;
  let oldCwd: string;
  let tests: AbTestDefinition[];
  let log: jest.SpyInstance;
  const stages = command === 'compare' ? ['visreg', 'perf'] : ['audit', 'accessibility'];
  const run = (...args: string[]) => (command === 'compare' ? createCompareCommand() : createAuditCommand())
    .exitOverride()
    .parseAsync(['--config', path.join(cwd, 'abtests.config.ts'), ...args], { from: 'user' });
  const store = () => new ArtifactStore(path.join(cwd, `${command}-results`));
  const report = () => {
    const html = fs.readFileSync(path.join(cwd, `${command}-results`, 'full-report.html'), 'utf8');
    return JSON.parse(html.match(/<script id="__shaka_report_data__" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
  };
  const saved = () => tests.flatMap((test) => ['desktop', 'phone'].flatMap((vp) => stages.flatMap((stage) => {
    const file = path.join(store().unitDirForViewport(test, vp), `${stage}.json`);
    return fs.existsSync(file) ? [{ file, bytes: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }] : [];
  })));

  beforeEach(() => {
    oldCwd = process.cwd(); cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'viewport-command-'));
    process.chdir(cwd); measured.length = 0;
    tests = [definition('Product Detail'), definition('Desktop only', ['desktop'])];
    jest.mocked(loadAbTestsConfig).mockResolvedValue(config as never);
    jest.mocked(loadTests).mockImplementation(async (options) => options?.filter
      ? tests.filter((test) => new RegExp(options.filter!).test(test.name)) : tests);
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { process.chdir(oldCwd); fs.rmSync(cwd, { recursive: true, force: true }); log.mockRestore(); });

  it('advertises the option and keeps the full matrix without it', async () => {
    expect((command === 'compare' ? createCompareCommand() : createAuditCommand()).helpInformation()).toContain('--viewport <label>');
    await run();
    expect(measured).toHaveLength(6);
    expect(measured.some((entry) => entry.startsWith('Desktop only:phone:'))).toBe(false);
  });

  it.each(['desktop', 'phone'])('intersects %s with per-test declarations', async (label) => {
    await run('--viewport', label);
    expect(measured).toHaveLength(label === 'desktop' ? 4 : 2);
    expect(measured.every((entry) => entry.includes(`:${label}:`))).toBe(true);
    expect(fs.existsSync(store().unitDirForViewport(tests[1]!, 'phone'))).toBe(false);
  });

  it('accepts a custom label from the configured registry', async () => {
    tests = [definition('Custom')];
    const custom = buildAbTestsConfig(config as never);
    jest.mocked(loadAbTestsConfig).mockResolvedValue({
      ...custom,
      shared: { ...custom.shared, viewports: ['wide'], viewportDefinitions: [
        { ...custom.shared.viewportDefinitions[0]!, label: 'wide' },
      ] },
    });
    await run('--viewport', 'wide');
    expect(measured).toEqual(stages.map((stage) => `Custom:wide:${stage}`));
    await expect(run('--viewport', 'desktop')).rejects.toThrow('Valid labels: wide.');
  });

  it('honors per-category viewport restrictions within a selected test', async () => {
    tests = [{ ...definition('Split'), config: {
      [stages[0]!]: { viewports: ['desktop'] },
      [stages[1]!]: { viewports: ['phone'] },
    } }];
    await run('--viewport', 'phone');
    expect(measured).toEqual([`Split:phone:${stages[1]}`]);
    expect(store().readOutcome(tests[0]!, 'phone', stages[0]!)?.kind).toBe('skipped');
    expect(fs.existsSync(store().unitDirForViewport(tests[0]!, 'desktop'))).toBe(false);
  });

  it.each([{ args: [] }, { args: ['--report-only'] }])('rejects unknown labels with valid choices (%j)', async ({ args }) => {
    await expect(run(...args, '--viewport', 'unknown')).rejects.toThrow(/Unknown viewport "unknown".*Valid labels: desktop, tablet, phone/);
    expect(measured).toEqual([]);
    expect(fs.existsSync(store().resultsRoot)).toBe(false);
  });

  it('rejects a valid label when the selected test has no work, preserving saved results', async () => {
    await run(); const before = saved(); measured.length = 0;
    await expect(run('--filter', '^Desktop only$', '--viewport', 'phone')).rejects.toThrow(/matched no work.*desktop/);
    expect(measured).toEqual([]); expect(saved()).toEqual(before);
  });

  it('reports no work when every selected test opts out of the selected category', async () => {
    tests = [{ ...definition('Opt out'), testTypes: [stages[0]!] } as AbTestDefinition];
    await expect(run('--categories', stages[1]!, '--viewport', 'phone')).rejects.toThrow(/matched no work/);
    expect(fs.existsSync(store().resultsRoot)).toBe(false);
  });

  it('preserves unselected outcomes, artifacts and run IDs while remeasuring one test/viewport', async () => {
    await run(); const before = saved(); measured.length = 0;
    const phoneDir = store().artifactsDirForViewport(tests[0]!, 'phone');
    fs.writeFileSync(path.join(phoneDir, 'old-frame.txt'), 'stale');
    const desktopDir = store().artifactsDirForViewport(tests[0]!, 'desktop');
    fs.writeFileSync(path.join(desktopDir, 'sibling.txt'), 'keep');
    fs.mkdirSync(path.join(store().resultsRoot, 'derived'));
    fs.writeFileSync(path.join(store().resultsRoot, 'derived', 'sibling.txt'), 'keep');
    await run('--filter', '^Product Detail$', '--viewport', 'phone');
    expect(measured).toEqual(stages.map((stage) => `Product Detail:phone:${stage}`));
    expect(fs.existsSync(path.join(phoneDir, 'old-frame.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(desktopDir, 'sibling.txt'), 'utf8')).toBe('keep');
    expect(fs.existsSync(path.join(store().resultsRoot, 'derived', 'sibling.txt'))).toBe(true);
    for (const entry of before) {
      const now = fs.readFileSync(entry.file, 'utf8');
      if (entry.file.startsWith(store().unitDirForViewport(tests[0]!, 'phone') + path.sep)) {
        expect(JSON.parse(now).runId).not.toBe(JSON.parse(entry.bytes).runId);
      } else {
        expect(now).toBe(entry.bytes); expect(fs.statSync(entry.file).mtimeMs).toBe(entry.mtime);
      }
    }
    const card = report().tests.find((test: { name: string }) => test.name === 'Product Detail');
    expect(new Set(card.outcomes.map((outcome: { runId: string }) => outcome.runId)).size).toBe(2);
    expect(new Set(card.outcomes.map((outcome: { viewport: { label: string } }) => outcome.viewport.label))).toEqual(new Set(['desktop', 'phone']));
  });

  it('does not rewrite unselected viewport skip markers', async () => {
    await run(); const before = saved().filter((entry) => entry.file.includes('desktop'));
    await run('--viewport', 'phone', '--categories', stages[0]!);
    for (const entry of before) expect(fs.readFileSync(entry.file, 'utf8')).toBe(entry.bytes);
    expect(fs.existsSync(store().unitDirForViewport(tests[1]!, 'phone'))).toBe(false);
  });

  it('keeps existing filter-only callers such as troubleshoot on their cleanup contract', async () => {
    await run();
    await runPipeline(mockPipeline(command), {
      config: buildAbTestsConfig(config as never), tests: [tests[0]!],
      controlURL: config.shared.controlURL, experimentURL: config.shared.experimentURL,
      viewportsFilter: ['phone'], skipReport: true,
    });
    expect(store().readOutcome(tests[0]!, 'desktop', stages[0]!)).toBeNull();
    expect(store().readOutcome(tests[0]!, 'phone', stages[0]!)?.kind).toBe('ok');
  });

  it('ignores viewport selection for report-only contents, freshness and saved run IDs', async () => {
    await run(); const before = saved(); const cards = report().tests; measured.length = 0;
    await run('--report-only', '--filter', '^Desktop only$', '--viewport', 'phone');
    expect(measured).toEqual([]); expect(saved()).toEqual(before);
    expect(report().tests).toEqual(cards);
  });
});
