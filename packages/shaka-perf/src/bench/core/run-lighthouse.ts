import chalk from 'chalk';
import type { RunnerResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';

import type { Marker, PhaseSample } from './lighthouse-config';
import { DEFAULT_MARKERS } from './lighthouse-config';
import { extractRawTraceTimestamp } from './extract-markers';
import { saveNetworkActivity, analyzeNetworkResources } from './network-activity';
import { runPatchedLighthouse } from './patched-lighthouse';
import { summarizePerformanceProfile } from './summarize-performance-profile';

// Read console errors whitelist from environment variable.
const allowedConsoleErrors: string[] = process.env
  .SHAKA_BENCH_ALLOWED_CONSOLE_ERRORS
  ? process.env.SHAKA_BENCH_ALLOWED_CONSOLE_ERRORS.split(',')
  : [];

export async function runLighthouse(
  prefix: string,
  url: string,
  lhSettings: any,
  resultsFolder: string,
  markers: Marker[] = DEFAULT_MARKERS,
  saveArtifacts: boolean = true,
  canStopTracking: Promise<unknown> = Promise.resolve(),
): Promise<{ phases: PhaseSample[], runnerResult: RunnerResult }> {
  // 5 minutes
  const timeoutMs = 300000;

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Lighthouse timeout'));
    }, timeoutMs);
  });

  const runnerResult = await Promise.race([
    runPatchedLighthouse(url, lhSettings, { canStopTracking }),
    timeoutPromise
  ]) as RunnerResult;

  if (timeout) {
    clearTimeout(timeout);
  }

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;
  const query = parsedUrl.search;

  const sanitized = `${prefix}${host}_${path}_${query}`.replace(/[/:?=]/g, '_');
  const namePrefix = `${resultsFolder}/${sanitized}`;

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

  const totalSizeBytes = saveNetworkActivity(runnerResult, url, saveArtifacts ? `${namePrefix}_network_activity.txt` : null);

  if (runnerResult.lhr.runtimeError) {
    throw new Error(
      `Lighthouse encountered runtime error when running ${url}: ${JSON.stringify(
        runnerResult.lhr.runtimeError,
        null,
        2
      )}`
    );
  }
  runnerResult.artifacts.ConsoleMessages?.forEach((message) => {
    if (
      !allowedConsoleErrors.some((allowedError) =>
        JSON.stringify(message).includes(allowedError)
      )
    ) {
      console.log(
        chalk.red(
          `Measurements Error: console.${message.level}: ${message.text} ${message.url} TESTED PAGE: ${url}`
        )
      );
    }
  });

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
      phase: prefix + name,
      duration: runnerResult.lhr.audits[audit].numericValue! * scale,
      start: 0,
      sign: 1,
      unit,
    }));

    results.push({
      phase: prefix + 'downloads',
      duration: totalSizeBytes / 1024,
      sign: 1,
      start: 0,
      unit: 'KB'
    });

    results.push({
      phase: prefix + 'LH Score',
      duration: runnerResult.lhr.categories.performance.score! * 100,
      sign: -1,
      start: 0,
      unit: '/100'
    });

    // Find the early-phase marker and extract its raw trace timestamp
    const earlyPhaseMarker = markers.find((m) => m.isEarlyPhase);
    const earlyPhaseTs = earlyPhaseMarker
      ? extractRawTraceTimestamp(runnerResult, earlyPhaseMarker.end)
      : null;

    results.push(...analyzeNetworkResources(runnerResult, url, earlyPhaseTs, prefix));
  }

  return { phases: results, runnerResult };
}
