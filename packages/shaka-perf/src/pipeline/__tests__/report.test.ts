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
import { ArtifactStore } from '../artifact-store';
import { writeMachineReport, type ReportMeta } from '../report';
import type { Pipeline, PipelineMachineReportMetaContext } from '../pipeline';
import type { StageRuntime } from '../../stage/stage';
import { parseAbTestsConfig } from '../../config';

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
      parseAbTestsConfig({
        shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031', parallelism: 1 },
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
