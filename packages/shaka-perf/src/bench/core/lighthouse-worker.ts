import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launch, type LaunchedChrome } from 'chrome-launcher';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { RaceCancellation } from 'race-cancellation';

import { loadConfigFile, loadTestFile, getRegisteredTests } from 'shaka-shared';
import type { BenchmarkSampler } from './run';
import { installBeforePageNavigateBarrier } from './barrier-synchronization';
import {
  DEFAULT_LH_CONFIG,
  DEFAULT_MARKERS,
  getCpuSlowdownMultiplier,
  type LighthouseBenchmarkOptions,
  type NavigationSample,
  type PhaseSample,
} from './lighthouse-config';
import { runLighthouse } from './run-lighthouse';
import { extractMarkers } from './extract-markers';
import { injectINPObserver, collectINP } from './inp';
import type { AbTestDefinition } from './ab-test-registry';

interface SetupMessage {
  type: 'setup';
  testFile: string;
  testName: string;
  baseUrl: string;
  group: string;
  options: LighthouseBenchmarkOptions;
}

interface SampleMessage {
  type: 'sample';
  iteration: number;
  isTrial: boolean;
}

interface DisposeMessage {
  type: 'dispose';
}

type ParentMessage = SetupMessage | SampleMessage | DisposeMessage;

class LighthouseWorkerSampler implements BenchmarkSampler<NavigationSample> {
  private chrome: LaunchedChrome | null = null;
  private userDataDir: string | null = null;

  constructor(
    private baseUrl: string,
    private testDef: AbTestDefinition,
    private options: LighthouseBenchmarkOptions,
    private group: string,
  ) {}

  async setupBrowser(): Promise<void> {
    const chromeFlags = [
      '--headless',
      '--ignore-certificate-errors',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ];

    if (process.env.TRACERBENCH_PROXY_URL) {
      chromeFlags.push(`--proxy-server=${process.env.TRACERBENCH_PROXY_URL}`);
    }

    this.userDataDir = await mkdtemp(join(tmpdir(), 'lighthouse-'));
    this.chrome = await launch({ chromeFlags, userDataDir: this.userDataDir });
  }

  async dispose(): Promise<void> {
    await this.chrome?.kill();
    if (this.userDataDir) {
      await rm(this.userDataDir, { recursive: true, force: true });
    }
  }

  async getMobileSettings(): Promise<any> {
    const { defaultConfig } = await import('lighthouse');
    return {
      ...defaultConfig?.settings,
      ...DEFAULT_LH_CONFIG,
      throttling: {
        ...DEFAULT_LH_CONFIG.throttling as object,
        cpuSlowdownMultiplier: process.env.CI ? 6 : 20,
      },
      port: this.chrome!.port,
    };
  }

  async sample(
    iteration: number,
    isTrial: boolean,
    _raceCancellation: RaceCancellation,
  ): Promise<NavigationSample> {
    const sampleLabel = isTrial ? 'warmup' : `sample-${Math.max(0, iteration - 1)}`;
    let lhSettings = await this.getMobileSettings();

    if (this.options.lhConfigPath) {
      const userConfig = await loadConfigFile(this.options.lhConfigPath);
      lhSettings = { ...lhSettings, ...userConfig, port: this.chrome!.port };
    }

    const fullUrl = this.fullUrl();
    const markers = this.testDef.options.markers ?? this.options.markers;
    const phases = await this.runLighthouseWithPlaywright(
      fullUrl,
      lhSettings,
      markers,
      iteration === 1,
      sampleLabel,
    );
    return { metadata: {}, duration: 0, phases };
  }

  private fullUrl(): string {
    const base = new URL(this.baseUrl);
    const path = this.group === 'experiment' && this.testDef.experimentPathOverride
      ? this.testDef.experimentPathOverride
      : this.testDef.startingPath;
    const parsed = new URL(path, base);
    for (const [key, value] of base.searchParams) {
      if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
    }
    return parsed.href;
  }

  private async runLighthouseWithPlaywright(
    url: string,
    lhSettings: any,
    markers: LighthouseBenchmarkOptions['markers'],
    saveArtifacts: boolean,
    sampleLabel: string,
  ): Promise<PhaseSample[]> {
    const browser = await chromium.connectOverCDP(`http://localhost:${this.chrome!.port}`);

    try {
      const context = browser.contexts()[0];
      await context.clearCookies();

      let releaseTracking: () => void = () => {};
      const canStopTracking = new Promise<void>((resolve) => {
        releaseTracking = resolve;
      });

      if (this.options.logDiagnosticTimings) {
        const timestamp = new Date();
        console.log(
          `[shaka-perf timing] subprocess Lighthouse start at ${timestamp.toISOString()} ` +
          `(epochMs=${timestamp.getTime()}, pid=${process.pid}, group=${this.group}, ${sampleLabel})`
        );
      }
      const lighthousePromise = runLighthouse(
        '',
        url,
        lhSettings,
        this.options.resultsFolder ?? './tracerbench-results',
        markers,
        saveArtifacts,
        canStopTracking,
      );

      const page = await this.waitForPage(context, url);
      await injectINPObserver(page);
      const playwrightPromise = this.testDef.testFn({
        page,
        browserContext: context,
        isControl: this.group === 'control',
        scenario: this.testDef,
        viewport: this.options.viewport,
        testType: 'perf',
        annotate: () => {},
      })
        .then(() => collectINP(page))
        .finally(() => releaseTracking());

      const [{ phases, runnerResult }, inp] = await Promise.all([lighthousePromise, playwrightPromise]);

      const multiplier = getCpuSlowdownMultiplier(lhSettings);
      for (const phase of extractMarkers(runnerResult, markers ?? DEFAULT_MARKERS, '')) {
        phases.push({ ...phase, duration: phase.duration * multiplier });
      }
      if (inp != null && inp > 0) {
        phases.push({
          phase: 'interaction-to-next-paint',
          duration: inp * 1000 * multiplier,
          start: 0,
          sign: 1,
          unit: 'ms',
        });
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for page at ${targetOrigin}`);
  }
}

function send(msg: object): boolean {
  try {
    return process.send!(msg);
  } catch {
    // Parent channel already closed — nothing we can do from here.
    return false;
  }
}

// Error payloads go to stderr first (captured by the parent's teeLinePrefixed
// → engine-output.log → readPerfEngineLog → report error dialog) and only
// then to IPC. Stderr is the canonical channel: even if IPC is dead (parent
// crashed, channel closed mid-teardown) the stack survives on disk.
function sendError(msg: { type: 'error'; message: string; stack: string }): void {
  try { process.stderr.write(JSON.stringify(msg) + '\n'); } catch { /* stderr closed */ }
  send(msg);
}

// Self-terminate if parent disconnects to prevent orphaned Chrome processes.
process.on('disconnect', () => {
  void shutdown(1);
});

// Async CDP / puppeteer failures during a sample can surface as unhandled
// rejections AFTER we've already returned a result or error for the current
// iteration. Without these, a late rejection crashes the worker with a bare
// stack trace on stderr — parent then hits ERR_IPC_CHANNEL_CLOSED on its next
// send and the whole pipeline dies. Report what we can and exit cleanly so the
// per-test try/catch upstream can record the failure and keep going.
function reportFatal(err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
  void shutdown(1);
}
process.on('unhandledRejection', reportFatal);
process.on('uncaughtException', reportFatal);

let sampler: BenchmarkSampler<NavigationSample> | null = null;
let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sampler?.dispose();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    try {
      process.stderr.write(`Failed to dispose Lighthouse worker sampler: ${error.stack ?? error.message}\n`);
    } catch { /* stderr closed */ }
  } finally {
    process.exit(exitCode);
  }
}

installBeforePageNavigateBarrier();
let logDiagnosticTimings = false;

function logSampleStart(msg: SampleMessage): void {
  if (!logDiagnosticTimings) return;
  const timestamp = new Date();
  const sampleLabel = msg.isTrial ? 'warmup' : `sample-${Math.max(0, msg.iteration - 1)}`;
  console.log(
    `[shaka-perf timing] subprocess sample command received at ${timestamp.toISOString()} ` +
    `(epochMs=${timestamp.getTime()}, pid=${process.pid}, ${sampleLabel})`
  );
}

process.on('message', async (msg: ParentMessage) => {
  if (shuttingDown) return;
  if (msg.type === 'setup') {
    try {
      await loadTestFile(msg.testFile);
      const tests = getRegisteredTests();
      const testDef = tests.find((t) => t.name === msg.testName);
      if (!testDef) {
        sendError({ type: 'error', message: `Test "${msg.testName}" not found in ${msg.testFile}`, stack: '' });
        process.exit(1);
        return;
      }

      logDiagnosticTimings = msg.options.logDiagnosticTimings === true;
      (globalThis as Record<string, unknown>).__shakaperfLogDiagnosticTimings =
        logDiagnosticTimings;
      const workerSampler = new LighthouseWorkerSampler(msg.baseUrl, testDef, msg.options, msg.group);
      sampler = workerSampler;
      await workerSampler.setupBrowser();
      if (shuttingDown) return;
      send({ type: 'ready' });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
      await shutdown(1);
    }
  } else if (msg.type === 'sample') {
    try {
      if (!sampler) throw new Error('lighthouse worker received sample before setup completed');
      logSampleStart(msg);
      const sample = await sampler.sample(msg.iteration, msg.isTrial, undefined as any);
      send({ type: 'result', sample });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
    }
  } else if (msg.type === 'dispose') {
    await shutdown(0);
  }
});

process.on('SIGTERM', () => {
  void shutdown(1);
});
process.on('SIGINT', () => {
  void shutdown(1);
});
