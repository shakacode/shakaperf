/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildAbTestsConfig } from '../../config';
import { loadTests } from '../../config-loader';
import { ArtifactStore } from '../artifact-store';
import { createPipeline } from '../pipeline';
import { runPipeline } from '../runner';

// The stages below only write saved outcomes; they take no measurements.
jest.mock('../measurement-lock', () => ({
  acquireMeasurementLock: async () => ({ release: () => {} }),
}));

describe.each(['compare', 'audit'] as const)('%s report discovery', (name) => {
  let cwd: string;
  let originalCwd: string;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    originalCwd = process.cwd();
    // Keep fixtures within the workspace so the real loader resolves shaka-shared.
    cwd = fs.mkdtempSync(path.join(__dirname, 'tmp-report-discovery-'));
    process.chdir(cwd);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const sharedPath = JSON.stringify(require.resolve('shaka-shared'));
    const register = (testName: string) =>
      `require(${sharedPath}).abTest('${testName}', { startingPath: '/' }, async () => {});`;
    fs.writeFileSync('checkout.abtest.js', register('Checkout'));
    fs.writeFileSync('catalog.abtest.js', register('Catalog'));
    fs.writeFileSync('broken.abtest.js', `${register('Partial registration')}
      throw new Error('Unrelated module import failed');`);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
    warn.mockRestore();
    log.mockRestore();
  });

  it.each(['file', 'path pattern'] as const)(
    'measures the selected %s despite a broken sibling and preserves saved report results',
    async (selection) => {
      const measuredTests: string[] = [];
      const stageName = name === 'compare' ? 'visreg' : 'audit';
      const pipeline = createPipeline({
        name,
        description: name,
        report: {
          reportLabel: name,
          renderHeaderUrls: () => null,
          renderTestCardUrls: () => null,
          renderDialogMetaUrls: () => null,
        },
      }, (builder) => {
        const pool = builder.registerWorkerPool(1);
        builder.runStage(pool, {
          name: stageName,
          category: stageName,
          label: stageName,
          description: stageName,
          selfContainedReportStrip: {},
          applies: () => true,
          run: async (ctx) => {
            measuredTests.push(ctx.test.name);
            return {};
          },
          renderArtifacts: () => null,
          machineReadableSummary: () => ({}),
        });
        builder.waitForAllTasksFinishAndDispose(pool);
        builder.buildChips({
          chipsForAllTests: (tests) => new Map(tests.map(({ test }) => [test, []])),
        });
        builder.buildSorts({ sortsForAllTests: () => new Map() });
      });
      const config = buildAbTestsConfig({
        shared: {
          controlURL: 'http://control.test',
          experimentURL: 'http://experiment.test',
          parallelism: 1,
          viewports: ['desktop'],
          playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
          browserConsole: { failOn: [], allowList: [] },
        },
      });
      const [catalog] = await loadTests({ filter: path.join(cwd, 'catalog.abtest.js') });
      const oldRunId = '2026-10-01T00:00:00.000Z';
      const store = new ArtifactStore(path.join(cwd, `${name}-results`), oldRunId);
      store.writeOutcome(catalog!, 'desktop', { kind: 'ok', stage: stageName, measurement: {} });
      const savedFile = path.join(store.unitDirForViewport(catalog!, 'desktop'), `${stageName}.json`);
      const savedBytes = fs.readFileSync(savedFile);
      const savedMtime = fs.statSync(savedFile).mtimeMs;
      const runtime = {
        cwd,
        config,
        controlURL: config.shared.controlURL,
        experimentURL: config.shared.experimentURL,
        ...(selection === 'file'
          ? { filter: path.join(cwd, 'checkout.abtest.js') }
          : { testPathPattern: 'checkout' }),
      };

      const result = await runPipeline(pipeline, runtime);

      expect(measuredTests).toEqual(['Checkout']);
      expect(result.hasFailures).toBe(false);
      expect(result.testResults.map((test) => test.name).sort()).toEqual(['Catalog', 'Checkout']);
      expect(result.testResults.find((test) => test.name === 'Catalog')?.runId).toBe(oldRunId);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/report.*broken\.abtest\.js.*Unrelated module import failed/i));

      const savedResults = result.testResults;
      for (const filter of [undefined, '^Checkout$']) {
        const regenerated = await runPipeline(pipeline, {
          ...runtime,
          reportOnly: true,
          filter,
        });
        expect(regenerated.testResults).toEqual(savedResults);
        expect(measuredTests).toEqual(['Checkout']);
        expect(fs.readFileSync(savedFile)).toEqual(savedBytes);
        expect(fs.statSync(savedFile).mtimeMs).toBe(savedMtime);
      }

      await expect(runPipeline(pipeline, {
        ...runtime,
        filter: path.join(cwd, 'broken.abtest.js'),
      })).rejects.toThrow('Unrelated module import failed');
      expect(measuredTests).toEqual(['Checkout']);
    },
  );
});
