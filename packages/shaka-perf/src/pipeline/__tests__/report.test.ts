/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactScope, ArtifactStore } from '../artifact-store';
import {
  reportDataForMode,
  writeMachineReport,
  type ReportData,
  type ReportMeta,
} from '../report';
import type { Pipeline, PipelineMachineReportMetaContext } from '../pipeline';
import type { StageRuntime } from '../../stage/stage';
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
        outcomes: [{
          kind: 'error',
          stage: 'visreg',
          viewport: { label: 'tablet' },
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
    const lightweight = reportDataForMode(data, 'lightweight', [], resultsRoot);

    expect(full.tests[0].outcomes[0].failure?.media).toBe(mediaPath);
    expect((full.tests[0].outcomes[0].measurement as {
      nested: Array<{ rawPath: string; timelinePath: string; videoPath: string }>;
    }).nested[0].rawPath).toBe(rawPath);
    expect(lightweight.tests[0].outcomes[0].failure?.media)
      .toBe(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);
    expect(lightweight.tests[0].outcomes[0].measurement).toEqual({
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
        shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 } },
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
