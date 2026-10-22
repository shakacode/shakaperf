/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import { buildAbTestsConfig } from '../../../config';
import { comparePipelineConfigFromAbTests } from '../../../compare/compare-pipeline';
import type { ReportData as PipelineReportData } from '../../report';
import type { BisectReportModel } from '../../../compare/bisect/report-model';
type ReportData = PipelineReportData & { bisect?: BisectReportModel };
import type { ReportOutcome, TestResult } from '../../report';
import type { RunMetadata } from '../../run-metadata';

const firstRun = '2026-10-20T20:54:53.891Z';
const secondRun = '2026-10-20T21:00:50.722Z';

export function runDetailsFixture(pipelineName: 'compare' | 'audit', reportMode: 'full' | 'self-contained' = 'full', bisect = false): ReportData {
  const audit = pipelineName === 'audit';
  const config = buildAbTestsConfig({ shared: { controlURL: 'http://127.0.0.1:3910', experimentURL: 'http://127.0.0.1:3910', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60000 }, browserConsole: { failOn: ['error'], allowList: [] }, timeoutMs: 60000, retries: 0, retryDelay: 0 } });
  const stage = audit ? 'audit' : 'perf';
  const measurement = audit ? { metrics: [{ label: 'LCP', value: 1800, unit: 'ms', display: '1.8 s', group: 'vitals', level: 'good' }] } : { metrics: [{
    label: 'LCP', group: 'vitals', controlValue: 1800, experimentValue: 2100, deltaValue: 300,
    controlDisplay: '1.8 s', experimentDisplay: '2.1 s', deltaDisplay: '+300 ms', percentDisplay: '+16.7%', deltaPercent: 16.7,
    pValue: 0.0078, direction: 'regression',
  }] };
  const metadata = (runId: string): RunMetadata => ({
    command: `shaka-perf ${pipelineName} --filter 'Homepage' --categories ${audit ? 'audit,accessibility' : 'perf,accessibility'}`,
    runId, measuredAt: runId, stages: [stage, 'accessibility'], categories: [audit ? 'audit' : 'perf', 'accessibility'],
    viewport: DESKTOP_VIEWPORT,
    targets: (audit ? ['experiment'] as const : ['control', 'experiment'] as const).map((side) => ({
      side, url: 'http://127.0.0.1:3910/',
      commit: { sha: '1e04e03852fee4e3257a2084f226189b97f13e2e', message: 'Redact complete credential values before persisting run details [skip ci]', source: 'Git in twin-server source checkout' },
    })),
    throttling: [{ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4, network: { rttMs: 150, throughputKbps: 1638.4 } }],
  });
  const result = (id: string, name: string, withMetadata: boolean): TestResult => ({
    id, name, filePath: `ab-tests/${id}.abtest.ts`, startingPath: '/',
    controlUrl: 'http://127.0.0.1:3910/', experimentUrl: 'http://127.0.0.1:3910/',
    code: "abTest('Homepage', { startingPath: '/' }, async ({ page }) => {\n  await waitUntilPageSettled(page);\n});",
    chips: [{ tag: audit ? 'good' : 'regression', text: audit ? 'Good LCP' : 'LCP +16.7%', color: audit ? 'green' : 'red', sortingWeight: 1 }], sorts: [], durationMs: 12000,
    measuredAt: Date.parse(secondRun), runId: secondRun,
    viewportArtifactPaths: [{ viewport: 'desktop', path: `results/${id}-desktop` }],
    outcomes: [
      { kind: 'ok', stage, measurement, viewport: DESKTOP_VIEWPORT, logs: '<0.1s> Measurement completed', ...(withMetadata ? { runMetadata: metadata(firstRun) } : {}) },
      { kind: 'error', stage: 'accessibility', error: { message: 'Accessibility scan timed out; performance result was retained.' }, viewport: DESKTOP_VIEWPORT, ...(withMetadata ? { runMetadata: { ...metadata(secondRun), throttling: [] } } : {}) },
      { kind: 'ok', stage, measurement, viewport: PHONE_VIEWPORT },
    ] as ReportOutcome[],
  });
  const data: ReportData = {
    meta: { title: `${pipelineName} report`, pipelineName, generatedAt: secondRun, controlUrl: config.shared.controlURL,
      experimentUrl: config.shared.experimentURL, durationMs: 12000, cwd: '/project', errors: [], reportOnly: true, reportMode,
      pipelineConfig: audit ? { parallelism: 1, accessibility: config.accessibility, agentReadiness: config.agentReadiness } : comparePipelineConfigFromAbTests(config) },
    tests: [result('homepage', 'Homepage', true), result('legacy', 'Older result · no saved metadata', false)],
  };
  if (bisect) data.bisect = {
    status: 'complete', goodSha: '97dfb9d1b52e37b9d76a725658f59a8367c5d485', badSha: '1e04e03852fee4e3257a2084f226189b97f13e2e', generatedAt: secondRun, repairs: [], repairApplications: [], targets: [], targetsById: {},
    views: { unresolved: { targetIds: [] }, invalid: { targetIds: [] } },
    commits: [{ sha: '97dfb9d1b52e37b9d76a725658f59a8367c5d485', subject: 'Baseline homepage', position: 0, measured: true, counts: { visreg: 0, perf: 0, accessibility: 0 }, targetIds: [] },
      { sha: '1e04e03852fee4e3257a2084f226189b97f13e2e', subject: 'Improve homepage rendering', position: 1, measured: true, counts: { visreg: 0, perf: 0, accessibility: 0 }, targetIds: [] }],
  };
  return data;
}
