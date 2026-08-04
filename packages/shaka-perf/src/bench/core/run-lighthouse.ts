/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RunnerResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LighthouseConfig, PhaseSample } from './lighthouse-config';
import { extractLcpRawTraceTimestamp } from './extract-markers';
import { saveNetworkActivity, analyzeNetworkResources } from './network-activity';
import { runPatchedLighthouse } from './patched-lighthouse';
import { summarizePerformanceProfile } from './summarize-performance-profile';
import type { Group } from '../../pipeline/log-prefix-format';

// Lighthouse accessibility score scaled to /100 (LH category scores are 0-1),
// or null when the run had no accessibility category. Writer does the rounding.
export function accessibilityScoreFromLhr(
  lhr: RunnerResult['lhr'],
): number | null {
  const score = lhr.categories?.accessibility?.score;
  return typeof score === 'number' ? score * 100 : null;
}

export async function runLighthouse(
  group: Group,
  url: string,
  lhSettings: LighthouseConfig,
  resultsFolder: string,
  saveArtifacts: boolean = true,
  canStopTracking: Promise<void> = Promise.resolve(),
): Promise<{ phases: PhaseSample[], runnerResult: RunnerResult }> {
  // Lighthouse's own `maxWaitForLoad` caps wait-for-fully-loaded, and
  // `withRaceTimeout` in the sampling worker pool kills hung runs at the
  // runner level. No third backstop here — one knob per level.
  const runnerResult = await runPatchedLighthouse(url, lhSettings, { canStopTracking });

  const namePrefix = join(resultsFolder, group);

  if (saveArtifacts) {
    writeFileSync(`${namePrefix}_lighthouse_report.html`, runnerResult.report as string);
    if (runnerResult.artifacts?.Trace) {
      const profilePath = `${namePrefix}_performance_profile.json`;
      writeFileSync(
        profilePath,
        JSON.stringify(runnerResult.artifacts.Trace)
      );
      summarizePerformanceProfile(profilePath, profilePath.replace('.json', '.summary.txt'));
    }
  }

  // Network metrics split on the page's LCP time: requests that finished before
  // LCP are the "before LCP" weight. Read straight from the trace — no config.
  const lcpTs = extractLcpRawTraceTimestamp(runnerResult);

  const totalSizeBytes = saveNetworkActivity(
    runnerResult,
    url,
    saveArtifacts ? `${namePrefix}_network_activity.txt` : null,
    lcpTs,
  );

  if (runnerResult.lhr.runtimeError) {
    throw new Error(
      `Lighthouse encountered runtime error when running ${url}: ${JSON.stringify(
        runnerResult.lhr.runtimeError,
        null,
        2
      )}`
    );
  }
  // Console messages are no longer read off Lighthouse's `ConsoleMessages`
  // artifact here. They are captured uniformly by the `console.*` patch that
  // `setUpContextForNavigation` installs, and turned into a verdict by
  // `assertPageConsoleClean` in the worker — so perf and visreg agree on what
  // counts as a violation and one `browserConsole.allowList` covers both.

  let results: PhaseSample[] = [];

  if (runnerResult.lhr.categories.performance) {
    const LH_AUDITS: { audit: string; name: string; unit: string; scale: number }[] = [
      { audit: 'first-contentful-paint', name: 'FCP', unit: 'ms', scale: 1000 },
      { audit: 'speed-index', name: 'speed-index', unit: 'ms', scale: 1000 },
      { audit: 'largest-contentful-paint', name: 'LCP', unit: 'ms', scale: 1000 },
      { audit: 'total-blocking-time', name: 'TBT', unit: 'ms', scale: 1000 },
      { audit: 'cumulative-layout-shift', name: 'CLS', unit: '/100', scale: 100 },
      { audit: 'server-response-time', name: 'TTFB', unit: 'ms', scale: 1000 },
    ];
    results = LH_AUDITS.map(({ audit, name, unit, scale }) => ({
      phase: name,
      duration: runnerResult.lhr.audits[audit].numericValue! * scale,
      start: 0,
      sign: 1,
      unit,
    }));

    results.push({
      phase: 'downloads',
      duration: totalSizeBytes / 1024,
      sign: 1,
      start: 0,
      unit: 'KB'
    });

    results.push({
      phase: 'LH Score',
      duration: runnerResult.lhr.categories.performance.score! * 100,
      sign: -1,
      start: 0,
      unit: '/100'
    });

    results.push(...analyzeNetworkResources(runnerResult, url, lcpTs));
  }

  return { phases: results, runnerResult };
}
