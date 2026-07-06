/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { PHONE_VIEWPORT, DESKTOP_VIEWPORT } from 'shaka-shared';
import { DEFAULT_LH_CONFIG, reportMetaForLighthouseRun } from '../../bench/core/lighthouse-config';
import { auditMachineReportMeta } from '../pipeline';
import type { PipelineMachineReportRow } from '../../pipeline/pipeline';

function row(
  viewport: typeof PHONE_VIEWPORT,
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

  it('keeps the Slow-4G label under CI runtime CPU overrides', () => {
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
