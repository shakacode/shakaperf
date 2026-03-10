import chalk from 'chalk';
import { execSync } from 'child_process';
import { launch, LaunchedChrome } from 'chrome-launcher';
import type { LighthouseResult } from 'lighthouse';
import type { RaceCancellation } from 'race-cancellation';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Benchmark, BenchmarkSampler } from './run';
import { loadConfigFile } from '../shared/load-config-file';

export interface Marker {
  start: string;
  label: string;
}

export interface LighthouseConfig {
  formFactor?: string;
  screenEmulation?: { mobile?: boolean; width?: number; height?: number; deviceScaleFactor?: number };
  throttling?: { rttMs?: number; throughputKbps?: number; requestLatencyMs?: number; downloadThroughputKbps?: number; uploadThroughputKbps?: number; cpuSlowdownMultiplier?: number } | false;
  logLevel?: string;
  output?: string;
  onlyCategories?: string[];
}

export function defineConfig(config: LighthouseConfig): LighthouseConfig {
  return config;
}

export const DEFAULT_LH_CONFIG: LighthouseConfig = {
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  logLevel: 'error',
  output: 'html',
  onlyCategories: ['performance'],
};

export interface LighthouseBenchmarkOptions {
  tbResultsFolder?: string;
  lhConfigPath?: string;
}

export interface PhaseSample {
  phase: string;
  start: number;
  duration: number;
  sign: 1 | -1;
  unit: string;
}

export interface NavigationSample {
  duration: number;
  phases: PhaseSample[];
  metadata: Record<string, unknown>;
}

interface DownloadsSizesKB {
  [filename: string]: number[];
}

const downloadsSizes: {
  [name: string]: DownloadsSizesKB;
} = {};

const saveDownloadsSizes = (
  downloadsSizes: DownloadsSizesKB,
  path: string
): void => {
  const downloads = Object.keys(downloadsSizes);

  downloads.sort((a, b) => a.localeCompare(b));

  const lines = downloads.map((url) => {
    const averageSize: number =
      downloadsSizes[url].reduce((partialSum, a) => partialSum + a, 0) /
      downloadsSizes[url].length;

    return `${url}\n⤷ ${(averageSize / 1024).toFixed(2)} KB. Downloaded ${
      downloadsSizes[url].length
    } times`;
  });

  writeFileSync(path, lines.join('\n') + '\n');
};

export function compareNetworkActivity(): void {
  const [controlReport, experimentReport] = Object.keys(downloadsSizes).map(
    (name) => {
      const reportFilePath = `${name}_network_activity.txt`;
      saveDownloadsSizes(downloadsSizes[name], reportFilePath);

      return {
        path: reportFilePath,
        totalSize: Object.values(downloadsSizes[name]).reduce(
          (partialSum, sizes) =>
            partialSum +
            sizes.reduce((partialSum, size) => partialSum + size, 0),
          0
        )
      };
    }
  );

  const totalSizeDiffKb =
    (experimentReport.totalSize - controlReport.totalSize) / 1024;

  if (totalSizeDiffKb != 0) {
    if (totalSizeDiffKb > 0) {
      console.log(
        chalk.red(
          `Total downloads size increased by ${totalSizeDiffKb.toFixed(2)} KB`
        )
      );
    } else {
      console.log(
        chalk.green(
          `Total downloads size decreased by ${-totalSizeDiffKb.toFixed(2)} KB`
        )
      );
    }
  }

  try {
    execSync(
      `git --no-pager  diff --no-index ${controlReport.path} ${experimentReport.path}`,
      { stdio: 'inherit' }
    );
  } catch {
    // do nothing
  }
}

const updateDownloadedSizes = (
  lighthouseResult: LighthouseResult,
  namePrefix: string,
  url: string
): number => {
  let totalSizeBytes = 0;
  downloadsSizes[namePrefix] = downloadsSizes[namePrefix] || {};
  const devtoolsLogs = lighthouseResult.artifacts.devtoolsLogs?.defaultPass;

  devtoolsLogs?.forEach((requestWillBeSentEntry) => {
    if (
      requestWillBeSentEntry.method === 'Network.requestWillBeSent' &&
      requestWillBeSentEntry.params.request
    ) {
      const parsedPageUrl = new URL(url);

      let requestUrl = requestWillBeSentEntry.params.request.url.replace(
        parsedPageUrl.origin,
        ''
      );
      if (
        requestUrl === '/graphql' &&
        requestWillBeSentEntry.params.request.postData
      ) {
        const postData = JSON.parse(
          requestWillBeSentEntry.params.request.postData
        );
        if (postData.operationName) {
          requestUrl =
            '/graphql?operationName="' + postData.operationName + '"';
        }
      }
      devtoolsLogs.find((loadingFinishedEntry) => {
        if (
          loadingFinishedEntry.method === 'Network.loadingFinished' &&
          loadingFinishedEntry.params.requestId ===
            requestWillBeSentEntry.params.requestId
        ) {
          const size = loadingFinishedEntry.params.encodedDataLength;
          if (!downloadsSizes[namePrefix][requestUrl]) {
            downloadsSizes[namePrefix][requestUrl] = [];
          }
          if (size) {
            downloadsSizes[namePrefix][requestUrl].push(size);
            totalSizeBytes += size;
          }
        }
      });
    }
  });

  return totalSizeBytes;
};

// Ligthouse applies some scaling factor to performance profiles.
// All performance.mark and performance.measure calls should be multiplied by this factor.
// Unfortunatly it's not exposed in the Lighthouse API.
// This is a manually determined value roughly representing the correct ratio.
const LIGHTHOUSE_SLOWDOWN_MULTIPLYER = 15;

function extractPerformanceMarkerTime(
  result: LighthouseResult,
  markerName: string
): number | null {
  const traceEvents = result.artifacts.traces.defaultPass.traceEvents;
  const event = traceEvents.find((event) => event.name === markerName);
  if (!event) {
    return null;
  }
  return event.args.data.startTime * LIGHTHOUSE_SLOWDOWN_MULTIPLYER;
}

function extractPerformanceDuration(
  result: LighthouseResult,
  startMarker: string,
  endMarker: string
): number | null {
  const startTime = extractPerformanceMarkerTime(result, startMarker);
  const endTime = extractPerformanceMarkerTime(result, endMarker);
  if (startTime === null || endTime === null) {
    return null;
  }
  return endTime - startTime;
}

// Read console errors whitelist from environement variable.
const allowedConsoleErrors: string[] = process.env
  .TRACERBENCH_ALLOWED_CONSOLE_ERRORS
  ? process.env.TRACERBENCH_ALLOWED_CONSOLE_ERRORS.split(',')
  : [];

async function runLighthouse(
  prefix: string,
  url: string,
  lhSettings: any,
  tbResultsFolder: string
): Promise<PhaseSample[]> {
  const lighthouse = (await eval("import('lighthouse')")).default;

  // 5 minutes
  const timeoutMs = 300000;

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Lighthouse timeout'));
    }, timeoutMs);
  });

  const runnerResult: LighthouseResult = await Promise.race([
    lighthouse(url, lhSettings),
    timeoutPromise
  ]);

  if (timeout) {
    clearTimeout(timeout);
  }

  runnerResult.lhr.categories;
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;
  const query = parsedUrl.search;

  const namePrefix = `${tbResultsFolder}/${prefix}${host.replace(
    ':',
    '_'
  )}_${path.replace(/\//g, '_')}_${query
    .replace(/\?/g, '_')
    .replace(/=/g, '_')}`;

  writeFileSync(`${namePrefix}_lighthouse_report.html`, runnerResult.report);
  if (runnerResult.artifacts?.traces?.defaultPass) {
    writeFileSync(
      `${namePrefix}_performance_profile.json`,
      JSON.stringify(runnerResult.artifacts.traces.defaultPass)
    );
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
        runnerResult.lhr.audits[phase].numericValue *
        (phase === 'cumulative-layout-shift' ? 100 : 1000),
      start: 0,
      addToChart: true,
      sign: 1,
      unit: phase === 'cumulative-layout-shift' ? '/100' : 'ms'
    }));

    const hydrationDuration = extractPerformanceDuration(
      runnerResult,
      'hydration-start',
      'hydration-end'
    );
    if (hydrationDuration != null) {
      results.push({
        phase: prefix + 'hydration',
        duration: hydrationDuration * 1000,
        sign: 1,
        start: 0,
        unit: 'ms'
      });
    }

    const hydrationStart = extractPerformanceMarkerTime(
      runnerResult,
      'hydration-start'
    );
    if (hydrationStart != null) {
      results.push({
        phase: prefix + 'hydration-start',
        duration: hydrationStart * 1000,
        sign: 1,
        start: 0,
        unit: 'ms'
      });
    }

    results.push({
      phase: prefix + 'downloads',
      duration: totalSizeBytes / 1024,
      sign: 1,
      start: 0,
      unit: 'KB'
    });

    results.push({
      phase: prefix + 'total-score',
      duration: runnerResult.lhr.categories.performance.score * 100,
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
      duration: runnerResult.lhr.categories.accessibility.score * 100,
      sign: -1,
      start: 0,
      unit: '/100'
    });
  }

  return results;
}

class LighthouseSampler implements BenchmarkSampler<NavigationSample> {
  private chrome: LaunchedChrome | null = null;
  private userDataDir: string | null = null;

  constructor(
    private url: string,
    private options: Partial<LighthouseBenchmarkOptions>
  ) {}

  async setupBrowser(): Promise<void> {
    const chromeFlags = [
      '--headless',
      // For Image Proxy
      '--ignore-certificate-errors',
      // There is no GPU on CI
      '--enable-unsafe-swiftshader',
      // The --disable-dev-shm-usage flag is needed to prevent Chrome from throwing PROTOCOL_TIMEOUT error in docker container.
      '--disable-dev-shm-usage'
    ];

    if (process.env.TRACERBENCH_PROXY_URL) {
      chromeFlags.push(`--proxy-server=${process.env.TRACERBENCH_PROXY_URL}`);
    }

    this.userDataDir = await mkdtemp(join(tmpdir(), 'lighthouse-'));
    this.chrome = await launch({
      chromeFlags,
      userDataDir: this.userDataDir
    });
  }

  async killBrowser(): Promise<void> {
    await this.chrome!.kill();
    await rm(this.userDataDir!, { recursive: true, force: true });
  }

  async dispose(): Promise<void> {
    await this.killBrowser();
  }

  async getMobileSettings(): Promise<any> {
    const defaultMobileSettings = (await eval("import('lighthouse')"))
      .defaultConfig.settings;
    return {
      ...defaultMobileSettings,
      ...DEFAULT_LH_CONFIG,
      throttling: {
        ...DEFAULT_LH_CONFIG.throttling as object,
        cpuSlowdownMultiplier: process.env.CI ? 6 : 20,
      },
      port: this.chrome!.port
    };
  }

  async sample(
    _iteration: number,
    _isTrial: boolean,
    _raceCancellation: RaceCancellation
  ): Promise<NavigationSample> {
    let lhSettings = await this.getMobileSettings();

    if (this.options.lhConfigPath) {
      const userConfig = await loadConfigFile(this.options.lhConfigPath);
      lhSettings = { ...lhSettings, ...userConfig, port: this.chrome!.port };
    }

    let lastError: Error | null = null;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const phases = await runLighthouse(
          '',
          this.url,
          lhSettings,
          this.options.tbResultsFolder ?? './tracerbench-results'
        );
        return {
          metadata: {},
          duration: 0,
          phases
        };
      } catch (error) {
        lastError = error as Error;
        if (attempt <= maxRetries) {
          console.log(chalk.red(lastError.message), lastError.stack);
          console.log(chalk.yellow(`Attempt ${attempt} failed, retrying...`));
          await this.killBrowser();
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await this.setupBrowser();
          lhSettings.port = this.chrome!.port;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          throw new Error(
            `Failed after ${maxRetries + 1} attempts. Last error: ${
              lastError?.message
            }`
          );
        }
      }
    }

    // unreachable, but satisfies TypeScript
    throw new Error('Unexpected: retry loop exited without result');
  }
}

export default function createLighthouseBenchmark(
  group: string,
  url: string,
  options: Partial<LighthouseBenchmarkOptions> = {}
): Benchmark<NavigationSample> {
  return {
    group,
    async setup(_raceCancellation) {
      const sampler = new LighthouseSampler(url, options);
      await sampler.setupBrowser();
      return sampler;
    }
  };
}
