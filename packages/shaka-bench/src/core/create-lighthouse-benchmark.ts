import chalk from 'chalk';
import { launch, LaunchedChrome } from 'chrome-launcher';
import type { RaceCancellation } from 'race-cancellation';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Benchmark, BenchmarkSampler } from './run';
import { loadConfigFile } from '../shared/load-config-file';
import { DEFAULT_LH_CONFIG, LighthouseBenchmarkOptions, NavigationSample } from './lighthouse-config';
import { runLighthouse } from './run-lighthouse';

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
          this.options.tbResultsFolder ?? './tracerbench-results',
          this.options.markers
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
