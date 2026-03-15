import chalk from 'chalk';
import { launch, LaunchedChrome } from 'chrome-launcher';
import { defaultConfig } from 'lighthouse';
import { chromium, BrowserContext, Page } from 'playwright-core';
import type { RaceCancellation } from 'race-cancellation';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Benchmark, BenchmarkSampler } from './run';
import { loadConfigFile } from 'shaka-shared';
import { DEFAULT_LH_CONFIG, LighthouseBenchmarkOptions, NavigationSample, PhaseSample } from './lighthouse-config';
import { runLighthouse } from './run-lighthouse';
import { injectINPObserver, collectINP } from './inp';
import type { AbTestDefinition } from './ab-test-registry';

class LighthouseSampler implements BenchmarkSampler<NavigationSample> {
  private chrome: LaunchedChrome | null = null;
  private userDataDir: string | null = null;

  constructor(
    private baseUrl: string,
    private testDef: AbTestDefinition,
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
    const defaultMobileSettings = defaultConfig?.settings;
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

    const fullUrl = this.baseUrl + this.testDef.startingPath;
    const markers = this.testDef.options.markers ?? this.options.markers;

    let lastError: Error | null = null;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const phases = await this.runLighthouseWithPlaywright(
          fullUrl,
          lhSettings,
          markers
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
    markers: LighthouseBenchmarkOptions['markers']
  ): Promise<PhaseSample[]> {
    const port = this.chrome!.port;
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);

    try {
      const context = browser.contexts()[0];

      // Start Lighthouse — it navigates the page itself
      const lighthousePromise = runLighthouse(
        '',
        url,
        lhSettings,
        this.options.resultsFolder ?? './tracerbench-results',
        markers
      );

      // Wait for the page to appear at the target URL, then run the Playwright test
      const page = await this.waitForPage(context, url);
      await injectINPObserver(page);
      const playwrightPromise = this.testDef.testFn({ page, browserContext: context, isReference: false }).then(() => collectINP(page));

      const [phases, inp] = await Promise.all([lighthousePromise, playwrightPromise]);

      if (inp != null && inp > 0) {
        phases.push({ phase: 'interaction-to-next-paint', duration: inp * 1000, start: 0, sign: 1, unit: 'ms' });
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
  options: Partial<LighthouseBenchmarkOptions> = {}
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
