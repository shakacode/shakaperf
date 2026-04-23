import chalk from 'chalk';
import { launch, LaunchedChrome } from 'chrome-launcher';
import { chromium, BrowserContext, Page } from 'playwright-core';
import type { RaceCancellation } from 'race-cancellation';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Benchmark, BenchmarkSampler } from './run';
import { loadConfigFile, TestType } from 'shaka-shared';
import { DEFAULT_LH_CONFIG, DEFAULT_MARKERS, getCpuSlowdownMultiplier, LighthouseBenchmarkOptions, NavigationSample, PhaseSample } from './lighthouse-config';
import { runLighthouse } from './run-lighthouse';
import { extractMarkers } from './extract-markers';
import { injectINPObserver, collectINP } from './inp';
import type { AbTestDefinition } from './ab-test-registry';

class LighthouseSampler implements BenchmarkSampler<NavigationSample> {
  private chrome: LaunchedChrome | null = null;
  private userDataDir: string | null = null;

  constructor(
    private baseUrl: string,
    private testDef: AbTestDefinition,
    private options: LighthouseBenchmarkOptions
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
    // Dynamic import because lighthouse v12+ is ESM-only and can't be require()'d from CommonJS
    const { defaultConfig } = await import('lighthouse');
    const defaultMobileSettings = defaultConfig?.settings;
    // CPU slowdown default: 20x locally, 6x on CI (CI machines are already slow).
    // User's bench.config.ts (applied via lhConfigPath in sample()) fully
    // overrides throttling — the demo's 1x takes effect through that path.
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
    iteration: number,
    _isTrial: boolean,
    _raceCancellation: RaceCancellation
  ): Promise<NavigationSample> {
    let lhSettings = await this.getMobileSettings();

    if (this.options.lhConfigPath) {
      const userConfig = await loadConfigFile(this.options.lhConfigPath);
      lhSettings = { ...lhSettings, ...userConfig, port: this.chrome!.port };
    }

    const base = new URL(this.baseUrl);
    const parsed = new URL(this.testDef.startingPath, base);
    // Preserve query params from baseUrl (e.g. ?hydration_delay=1000)
    for (const [key, value] of base.searchParams) {
      if (!parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, value);
      }
    }
    const fullUrl = parsed.href;
    const markers = this.testDef.options.markers ?? this.options.markers;

    let lastError: Error | null = null;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const saveArtifacts = iteration === 1;
        const phases = await this.runLighthouseWithPlaywright(
          fullUrl,
          lhSettings,
          markers,
          saveArtifacts
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

  private async runLighthouseWithPlaywright(
    url: string,
    lhSettings: any,
    markers: LighthouseBenchmarkOptions['markers'],
    saveArtifacts: boolean = true
  ): Promise<PhaseSample[]> {
    const port = this.chrome!.port;
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);

    try {
      const context = browser.contexts()[0];

      // Clear cookies before each sample so every measurement is a cold load.
      // The userDataDir is reused across samples in a sampler, so cookies set
      // by one sample (e.g. an auth cookie after a login testFn) would leak
      // into the next and break subsequent measurements.
      await context.clearCookies();

      // Keep Lighthouse measuring until the playwright testFn finishes.
      // `canStopTracking` is resolved from testFn's `.finally(...)` below;
      // until then, the patched Lighthouse keeps its driver attached so
      // post-load interactions are captured.
      let releaseTracking: () => void = () => {};
      const canStopTracking = new Promise<void>((resolve) => {
        releaseTracking = resolve;
      });

      // Start Lighthouse — it navigates the page itself
      const lighthousePromise = runLighthouse(
        '',
        url,
        lhSettings,
        this.options.resultsFolder ?? './tracerbench-results',
        markers,
        saveArtifacts,
        canStopTracking,
      );

      // Wait for the page to appear at the target URL, then run the Playwright test
      const page = await this.waitForPage(context, url);
      await injectINPObserver(page);
      const playwrightPromise = this.testDef.testFn({
        page,
        browserContext: context,
        isReference: false,
        scenario: this.testDef,
        viewport: this.options.viewport,
        testType: TestType.Performance,
        annotate: () => {},
      })
        .then(() => collectINP(page))
        // Release the tracking hold whether testFn succeeded or threw; otherwise
        // Lighthouse gather would idle until maxWaitForLoadedMs on any test error.
        .finally(() => releaseTracking());

      const [{ phases, runnerResult }, inp] = await Promise.all([lighthousePromise, playwrightPromise]);

      const multiplier = getCpuSlowdownMultiplier(lhSettings);
      for (const phase of extractMarkers(runnerResult, markers ?? DEFAULT_MARKERS, '')) {
        phases.push({ ...phase, duration: phase.duration * multiplier });
      }
      if (inp != null && inp > 0) {
        phases.push({ phase: 'interaction-to-next-paint', duration: inp * 1000 * multiplier, start: 0, sign: 1, unit: 'ms' });
      }

      return phases;
    } finally {
      await browser.close();
    }
  }

  private async waitForPage(context: BrowserContext, url: string): Promise<Page> {
    const targetOrigin = new URL(url).origin;
    const timeout = 30_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      for (const page of context.pages()) {
        if (page.url().startsWith(targetOrigin)) {
          await page.waitForLoadState('domcontentloaded');
          return page;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for page at ${targetOrigin}`);
  }
}

export default function createLighthouseBenchmark(
  group: string,
  baseUrl: string,
  testDef: AbTestDefinition,
  options: LighthouseBenchmarkOptions
): Benchmark<NavigationSample> {
  return {
    group,
    async setup(_raceCancellation) {
      const sampler = new LighthouseSampler(baseUrl, testDef, options);
      await sampler.setupBrowser();
      return sampler;
    }
  };
}
