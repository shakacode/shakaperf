/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { ArtifactScope, ArtifactStore } from '../artifact-store';
import {
  buildSelfContainedArtifactDictionary,
  reportDataForMode,
  prepareReportData,
  SELF_CONTAINED_REPORT_FILENAME,
  writeReport,
  writeMachineReport,
  type ReportData,
  type ReportMeta,
} from '../report';
import type { Pipeline, PipelineMachineReportMetaContext } from '../pipeline';
import type { Stage, StageRuntime } from '../../stage/stage';
import { buildAbTestsConfig } from '../../config';

describe('ArtifactScope', () => {
  let resultsRoot: string;

  beforeEach(() => {
    resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-artifact-scope-'));
  });

  afterEach(() => {
    fs.rmSync(resultsRoot, { recursive: true, force: true });
  });

  it('returns report-relative paths for written and existing artifacts', async () => {
    const artifactsDir = path.join(resultsRoot, 'checkout-tablet', 'artifacts');
    const scope = new ArtifactScope(artifactsDir, resultsRoot);

    await expect(scope.writeFile('failure.png', Buffer.from('png')))
      .resolves.toBe('checkout-tablet/artifacts/failure.png');
    expect(scope.pathFor('screencast.mp4'))
      .toBe('checkout-tablet/artifacts/screencast.mp4');
    expect(scope.pathFor('control_screenshots/home.png'))
      .toBe('checkout-tablet/artifacts/control_screenshots/home.png');
    expect(() => scope.pathFor('../outside.png'))
      .toThrow('artifact path must stay inside its scope');
    expect(fs.readFileSync(path.join(artifactsDir, 'failure.png')))
      .toEqual(Buffer.from('png'));
  });
});

describe('reportDataForMode', () => {
  let resultsRoot: string;

  beforeEach(() => {
    resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-report-mode-'));
  });

  afterEach(() => {
    fs.rmSync(resultsRoot, { recursive: true, force: true });
  });

  it('packages the execution source explicitly in both modes without a card-level copy', async () => {
    const source = "abTest('Checkout', {}, async () => {});";
    const scope = new ArtifactScope(path.join(resultsRoot, 'checkout-desktop', 'artifacts'), resultsRoot);
    const testSourceHref = await scope.writeFile('test-source.ts', source);
    const data = {
      meta: { reportMode: 'full' },
      tests: [{ name: 'Checkout',  outcomes: [{ executionDetails: { viewport: DESKTOP_VIEWPORT, testSourceHref, runId: 'fixture-run', recoveredAfterRetries: false },
        kind: 'ok', stage: 'visreg',
      }] }],
    } as unknown as ReportData;
    const dictionary = await buildSelfContainedArtifactDictionary(data, resultsRoot);
    expect(dictionary).not.toHaveProperty(testSourceHref);
    for (const mode of ['full', 'self-contained'] as const) {
      const projected = reportDataForMode(data, mode, [], resultsRoot, dictionary);
      expect(projected.tests[0]).not.toHaveProperty('code');
      const href = projected.tests[0]!.outcomes[0]!.executionDetails.testSourceHref!;
      expect(href).toBe(`data:text/plain;charset=utf-8;base64,${Buffer.from(source).toString('base64')}`);
      expect(data.tests[0]!.outcomes[0]!.executionDetails.testSourceHref).toBe(testSourceHref);

    }
  });

  it('traverses only artifact payloads, regardless of property names inside measurements', async () => {
    const asset = 'checkout-tablet/artifacts/raw.json';
    fs.mkdirSync(path.dirname(path.join(resultsRoot, asset)), { recursive: true });
    fs.writeFileSync(path.join(resultsRoot, asset), '{"ok":true}');
    const data = { meta: { title: asset }, tests: [{ filePath: asset, outcomes: [{
      kind: 'ok', stage: 'visreg',
      executionDetails: { runId: asset, viewport: DESKTOP_VIEWPORT, testSourceHref: null, recoveredAfterRetries: false },
      runMetadata: { command: asset },
      measurement: { runMetadata: asset, executionDetails: asset },
    }] }] } as unknown as ReportData;
    const dictionary = await buildSelfContainedArtifactDictionary(data, resultsRoot);
    expect(Object.keys(dictionary)).toEqual([asset]);
    const packaged = reportDataForMode(data, 'self-contained', [], resultsRoot, dictionary);
    expect(packaged.meta.title).toBe(asset);
    expect(packaged.tests[0]!.filePath).toBe(asset);
    expect(packaged.tests[0]!.outcomes[0]!.runMetadata).toBe(data.tests[0]!.outcomes[0]!.runMetadata);
    expect(packaged.tests[0]!.outcomes[0]!.executionDetails.runId).toBe(asset);
    expect(packaged.tests[0]!.outcomes[0]!.measurement).toEqual({ runMetadata: dictionary[asset], executionDetails: dictionary[asset] });
  });

  it('marks a missing source unavailable without borrowing another execution source', () => {
    const data = { meta: {}, tests: [{ outcomes: [{ kind: 'ok', stage: 'visreg',
      executionDetails: { runId: 'run', viewport: DESKTOP_VIEWPORT, testSourceHref: 'missing.ts', recoveredAfterRetries: false },
    }] }] } as unknown as ReportData;
    for (const mode of ['full', 'self-contained'] as const) {
      expect(reportDataForMode(data, mode, [], resultsRoot).tests[0]!.outcomes[0]!.executionDetails.testSourceHref).toBeNull();
    }
    expect(data.tests[0]!.outcomes[0]!.executionDetails.testSourceHref).toBe('missing.ts');
  });

  it('inlines every artifact path only in the self-contained report', () => {
    const artifactDir = path.join(resultsRoot, 'checkout-tablet', 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'failure.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(artifactDir, 'raw.json'), '{"ok":true}');
    fs.writeFileSync(path.join(artifactDir, 'timeline.webp'), Buffer.from('webp'));
    fs.writeFileSync(path.join(artifactDir, 'failure.mp4'), Buffer.from('video'));
    const mediaPath = 'checkout-tablet/artifacts/failure.png';
    const rawPath = 'checkout-tablet/artifacts/raw.json';
    const timelinePath = 'checkout-tablet/artifacts/timeline.webp';
    const videoPath = 'checkout-tablet/artifacts/failure.mp4';
    const data = {
      meta: { reportMode: 'full' },
      tests: [{
        name: 'Checkout',
        outcomes: [{ executionDetails: { viewport: { label: 'tablet' }, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false },
          kind: 'error',
          stage: 'visreg',

          failure: { media: mediaPath },
          measurement: {
            nested: [{ rawPath, timelinePath, videoPath }],
            url: 'https://example.test/artifact.png',
            label: 'raw.json',
          },
        }],
      }],
    } as unknown as ReportData;

    const full = reportDataForMode(data, 'full', [], resultsRoot);
    const selfContained = reportDataForMode(
      data,
      'self-contained',
      [],
      resultsRoot,
    );

    expect(full.tests[0].outcomes[0].failure?.media).toBe(mediaPath);
    expect((full.tests[0].outcomes[0].measurement as {
      nested: Array<{ rawPath: string; timelinePath: string; videoPath: string }>;
    }).nested[0].rawPath).toBe(rawPath);
    expect(selfContained.tests[0].outcomes[0].failure?.media)
      .toBe(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);
    expect(selfContained.tests[0].outcomes[0].measurement).toEqual({
      nested: [{
        rawPath: `data:application/json;base64,${
          Buffer.from('{"ok":true}').toString('base64')
        }`,
        timelinePath: `data:image/webp;base64,${
          Buffer.from('webp').toString('base64')
        }`,
        videoPath: `data:video/mp4;base64,${
          Buffer.from('video').toString('base64')
        }`,
      }],
      url: 'https://example.test/artifact.png',
      label: 'raw.json',
    });
  });

  it('encodes only post-strip artifacts into the self-contained dictionary', async () => {
    const artifactDir = path.join(resultsRoot, 'checkout-tablet', 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    const visiblePath = 'checkout-tablet/artifacts/accessibility-screenshot.png';
    const hiddenPath = 'checkout-tablet/artifacts/accessibility-raw.json';
    const coveragePath =
      'checkout-tablet/artifacts/coverage-statement-ids.json';
    const unlistedImagePath =
      'checkout-tablet/artifacts/internal-screenshot.png';
    const image = await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 3,
        background: '#ff0000',
      },
    }).png().toBuffer();
    fs.writeFileSync(path.join(resultsRoot, visiblePath), image);
    fs.writeFileSync(path.join(resultsRoot, unlistedImagePath), image);
    fs.writeFileSync(path.join(resultsRoot, hiddenPath), '{"secret":true}');
    fs.writeFileSync(path.join(resultsRoot, coveragePath), '["app.js:1"]');
    const data = {
      meta: { reportMode: 'self-contained' },
      tests: [{
        name: 'Checkout',
        outcomes: [{ executionDetails: { viewport: { label: 'tablet' }, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false },
          kind: 'ok',
          stage: 'accessibility',

          measurement: {
            visiblePath,
            hiddenPath,
            coveragePath,
            unlistedImagePath,
          },
        }],
      }],
    } as unknown as ReportData;
    const stage = {
      name: 'accessibility',
      category: 'accessibility',
      selfContainedReportStrip: {
        visiblePath: false,
        hiddenPath: true,
        coveragePath: true,
      },
    } as unknown as Stage;

    const artifacts = await buildSelfContainedArtifactDictionary(
      prepareReportData(data, 'self-contained', [stage], resultsRoot),
      resultsRoot,
    );
    const selfContained = reportDataForMode(
      data,
      'self-contained',
      [stage],
      resultsRoot,
      artifacts,
    );

    expect(Object.keys(artifacts)).toEqual([
      visiblePath,
      unlistedImagePath,
    ]);
    expect(artifacts[visiblePath]).toMatch(/^data:image\/avif;base64,/);
    expect(artifacts[unlistedImagePath]).toMatch(/^data:image\/avif;base64,/);
    expect(selfContained.tests[0].outcomes[0].measurement).toEqual({
      visiblePath: artifacts[visiblePath],
      unlistedImagePath: artifacts[unlistedImagePath],
    });
    expect(JSON.stringify(selfContained)).not.toContain('secret');
  });

  it('writes the self-contained report from the centralized dictionary', async () => {
    const artifactDir = path.join(resultsRoot, 'checkout-tablet', 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    const imagePath = 'checkout-tablet/artifacts/control.png';
    fs.writeFileSync(
      path.join(resultsRoot, imagePath),
      await sharp({
        create: {
          width: 100,
          height: 50,
          channels: 3,
          background: '#00ff00',
        },
      }).png().toBuffer(),
    );
    const data: ReportData = {
      meta: {
        title: 'Report',
        pipelineName: 'compare',
        generatedAt: '2026-07-28T00:00:00.000Z',
        controlUrl: 'https://control.test',
        experimentUrl: 'https://experiment.test',
        durationMs: 1,
        cwd: resultsRoot,
        errors: [],
        reportOnly: false,
        pipelineConfig: {},
        reportMode: 'full',
      },
      tests: [{
        id: 'checkout',
        name: 'Checkout',
        filePath: 'checkout.ts',
        startingPath: '/',
        controlUrl: 'https://control.test',
        experimentUrl: 'https://experiment.test',

        chips: [],
        sorts: [],
        durationMs: 1,
        measuredAt: null,
        runId: null,
        outcomes: [{ executionDetails: { viewport: {
            label: 'tablet',
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
            formFactor: 'desktop',
          }, testSourceHref: null, runId: 'fixture-run', recoveredAfterRetries: false },
          kind: 'ok',
          stage: 'visreg',

          measurement: { controlImage: imagePath },
        }],
        viewportArtifactPaths: [],
      }],
    };
    const stripRule = jest.fn(() => false);
    const original = JSON.stringify(data);
    const stage = {
      name: 'visreg',
      category: 'visreg',
      renderArtifacts: () => null,
      selfContainedReportStrip: { get controlImage() { return stripRule(); } },
    } as unknown as Stage;

    await writeReport(data, resultsRoot, [stage]);

    const html = fs.readFileSync(
      path.join(resultsRoot, SELF_CONTAINED_REPORT_FILENAME),
      'utf8',
    );
    expect(html).toContain('data:image/avif;base64,');
    expect(html).not.toContain(imagePath);
    expect(stripRule).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(data)).toBe(original);
    const fullHtml = fs.readFileSync(path.join(resultsRoot, 'full-report.html'), 'utf8');
    expect(fullHtml).toContain(imagePath);
    expect(fullHtml).not.toContain('data:image/avif;base64,');
  });
});

describe('writeMachineReport', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-machine-report-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists optional throttle profile and viewport meta', () => {
    const reportPath = path.join(dir, 'report.json');
    let capturedReportOnly: boolean | undefined;
    const meta: ReportMeta = {
      title: 'Audit',
      pipelineName: 'audit',
      generatedAt: '2026-07-01T00:00:00.000Z',
      controlUrl: 'https://example.com',
      experimentUrl: 'https://example.com',
      durationMs: 123,
      cwd: dir,
      errors: [],
      reportOnly: false,
      pipelineConfig: {},
      reportMode: 'full',
    };

    writeMachineReport(
      reportPath,
      [],
      () => [],
      {
        name: 'audit',
        stages: [],
        machineReportMeta: (ctx: PipelineMachineReportMetaContext) => {
          capturedReportOnly = ctx.reportOnly;
          return { throttleProfile: 'Slow-4G', viewport: { width: 390, height: 844 } };
        },
      } as unknown as Pipeline,
      meta,
      new ArtifactStore(dir),
      { resultsRoot: dir } as StageRuntime,
      new Map(),
      buildAbTestsConfig({
        shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] } },
      }),
    );

    const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
      meta: { throttleProfile?: string; viewport?: { width?: number; height?: number } };
    };

    expect(payload.meta.throttleProfile).toBe('Slow-4G');
    expect(payload.meta.viewport).toEqual({ width: 390, height: 844 });
    expect(capturedReportOnly).toBe(false);
  });
});
