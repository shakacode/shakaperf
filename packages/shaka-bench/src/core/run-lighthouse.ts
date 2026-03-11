import chalk from 'chalk';
import lighthouse, { type RunnerResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';

import type { Marker, PhaseSample } from './lighthouse-config';
import { DEFAULT_MARKERS } from './lighthouse-config';
import { extractMarkers } from './extract-markers';
import { updateDownloadedSizes } from './network-activity';
import { summarizePerformanceProfile } from './summarize-performance-profile';

// Read console errors whitelist from environement variable.
const allowedConsoleErrors: string[] = process.env
  .TRACERBENCH_ALLOWED_CONSOLE_ERRORS
  ? process.env.TRACERBENCH_ALLOWED_CONSOLE_ERRORS.split(',')
  : [];

export async function runLighthouse(
  prefix: string,
  url: string,
  lhSettings: any,
  resultsFolder: string,
  markers: Marker[] = DEFAULT_MARKERS
): Promise<PhaseSample[]> {
  // 5 minutes
  const timeoutMs = 300000;

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Lighthouse timeout'));
    }, timeoutMs);
  });

  const runnerResult = await Promise.race([
    lighthouse(url, lhSettings),
    timeoutPromise
  ]) as RunnerResult;

  if (timeout) {
    clearTimeout(timeout);
  }

  runnerResult.lhr.categories;
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;
  const query = parsedUrl.search;

  const namePrefix = `${resultsFolder}/${prefix}${host.replace(
    ':',
    '_'
  )}_${path.replace(/\//g, '_')}_${query
    .replace(/\?/g, '_')
    .replace(/=/g, '_')}`;

  writeFileSync(`${namePrefix}_lighthouse_report.html`, runnerResult.report as string);
  if (runnerResult.artifacts?.traces?.defaultPass) {
    const profilePath = `${namePrefix}_performance_profile.json`;
    writeFileSync(
      profilePath,
      JSON.stringify(runnerResult.artifacts.traces.defaultPass)
    );
    summarizePerformanceProfile(profilePath, profilePath.replace('.json', '.summary.txt'));
  }

  const totalSizeBytes = updateDownloadedSizes(runnerResult, namePrefix, url);

  if (runnerResult.lhr.runtimeError) {
    throw new Error(
      `Tracerbench encountered runtime error when running ${url}: ${JSON.stringify(
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
    results = [
      'first-contentful-paint',
      'speed-index',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'server-response-time'
    ].map((phase) => ({
      phase: prefix + phase,
      duration:
        runnerResult.lhr.audits[phase].numericValue! *
        (phase === 'cumulative-layout-shift' ? 100 : 1000),
      start: 0,
      addToChart: true,
      sign: 1,
      unit: phase === 'cumulative-layout-shift' ? '/100' : 'ms'
    }));

    results.push(...extractMarkers(runnerResult, markers, prefix));

    results.push({
      phase: prefix + 'downloads',
      duration: totalSizeBytes / 1024,
      sign: 1,
      start: 0,
      unit: 'KB'
    });

    results.push({
      phase: prefix + 'total-score',
      duration: runnerResult.lhr.categories.performance.score! * 100,
      sign: -1,
      start: 0,
      unit: '/100'
    });
  }

  if (runnerResult.lhr.categories.accessibility) {
    runnerResult.artifacts.Accessibility?.violations?.forEach((violation) => {
      violation.nodes.forEach((node) => {
        console.log(
          chalk.red(
            `Lighthouse acessibility violation ID=${violation.id} SELECTOR="${node.node.selector}" SNIPPET=${node.node.snippet} URL=${url}`
          )
        );
      });
    });
    results.unshift({
      phase: prefix + 'accessibility',
      duration: runnerResult.lhr.categories.accessibility.score! * 100,
      sign: -1,
      start: 0,
      unit: '/100'
    });
  }

  return results;
}
