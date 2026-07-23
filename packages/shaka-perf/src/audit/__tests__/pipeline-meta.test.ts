/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { PHONE_VIEWPORT, DESKTOP_VIEWPORT, TABLET_VIEWPORT, type Viewport } from 'shaka-shared';
import { DEFAULT_LH_CONFIG, reportMetaForLighthouseRun } from '../../bench/core/lighthouse-config';
import { auditMachineReportMeta, createAuditPipeline } from '../pipeline';
import type { PipelineMachineReportRow } from '../../pipeline/pipeline';

function row(
  viewport: Viewport,
  outcomes: PipelineMachineReportRow['outcomes'] = [{ kind: 'ok', stage: 'audit', measurement: {} }],
): PipelineMachineReportRow {
  return { viewport, outcomes };
}

describe('auditMachineReportMeta', () => {
  const priorCi = process.env.CI;

  afterEach(() => {
    if (priorCi === undefined) delete process.env.CI;
    else process.env.CI = priorCi;
  });

  it('falls back to Slow-4G and omits viewport when no viewport is available to the Lighthouse helper', () => {
    expect(reportMetaForLighthouseRun(undefined)).toEqual({
      throttleProfile: 'Slow-4G',
    });
  });

  it('keeps the configured Slow-4G profile label under CI CPU calibration', () => {
    process.env.CI = 'true';

    expect(reportMetaForLighthouseRun(undefined)).toEqual({
      throttleProfile: 'Slow-4G',
    });
  });

  it('persists the active mobile Lighthouse viewport dimensions from audited rows', () => {
    expect(auditMachineReportMeta({}, [row(DESKTOP_VIEWPORT), row(PHONE_VIEWPORT)])).toEqual({
      throttleProfile: 'Slow-4G',
      viewport: { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    });
  });

  it('persists audit meta from saved rows during report-only runs', () => {
    const pipeline = createAuditPipeline({
      parallelism: 1,
      accessibility: {
        tags: [],
        disableRules: [],
        failOnViolation: true,
        playwrightOptions: { browser: 'chromium' },
      },
      agentReadiness: { playwrightOptions: { browser: 'chromium' } },
    });

    expect(pipeline.machineReportMeta?.({ rows: [row(PHONE_VIEWPORT)], reportOnly: true })).toEqual({
      throttleProfile: 'Slow-4G',
      viewport: { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    });
  });

  it('prefers phone-class viewport dimensions over tablet mobile form factors', () => {
    expect(auditMachineReportMeta({}, [row(DESKTOP_VIEWPORT), row(TABLET_VIEWPORT), row(PHONE_VIEWPORT)])).toEqual({
      throttleProfile: 'Slow-4G',
      viewport: { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    });
  });

  it('omits audit meta when no row has a successful audit outcome', () => {
    expect(auditMachineReportMeta({}, [row(PHONE_VIEWPORT, [{ kind: 'skipped', stage: 'audit', reason: 'skip' }])])).toEqual({});
  });

  it('keeps viewport but omits Slow-4G when throttling is customized', () => {
    expect(auditMachineReportMeta({
      lighthouseConfig: {
        throttling: {
          ...DEFAULT_LH_CONFIG.throttling,
          cpuSlowdownMultiplier: 8,
        },
      },
    }, [row(PHONE_VIEWPORT)])).toEqual({
      viewport: { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    });
  });
});
