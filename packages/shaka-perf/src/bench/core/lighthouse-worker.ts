/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launch, type LaunchedChrome } from 'chrome-launcher';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import {
  getRegisteredTests,
  clearRegistry,
} from 'shaka-shared';
import {
  createTestAnnotate,
  getLatestTestAnnotation,
  runWithTestAnnotationContext,
} from '../../test-annotation';
import { loadTestFile } from '../../config-loader';
import { setUpContextForNavigation } from '../../pre-navigation';
import { reconstructEffectiveConfig } from '../../effective-config';
import { installBeforePageNavigateBarrier } from './barrier-synchronization';
import {
  DEFAULT_LH_CONFIG,
  DEFAULT_MARKERS,
  getCpuSlowdownMultiplier,
  makeNavigationSample,
  SCREENCAST_FILENAME,
  type LighthouseBenchmarkOptions,
  type LighthouseConfig,
  type NavigationSample,
  type PhaseSample,
} from './lighthouse-config';
import { runLighthouse, accessibilityScoreFromLhr } from './run-lighthouse';
import { SHAKA_PERF_ANNOTATION_PREFIX } from './timeline-comparison';
import { importPatchedLighthouse } from './patched-lighthouse';
import { extractMarkers } from './extract-markers';
import { injectINPObserver, collectINP } from './inp';
import { createInteractionRecorder } from './interaction-recorder';
import { attachInteractionOverlay } from '../../pipeline/interaction-overlay';
import type { AbTestDefinition } from './ab-test-registry';
import { sendErrorFrame } from './worker-log';
import { existsSync, writeFileSync } from 'node:fs';
import { screencastRecorder } from './screencast-recorder';

/**
 * Filename for the live-browser screenshot the worker captures on failure.
 * Lives directly under `options.resultsFolder` — which the stage points at
 * the same dir as `ctx.artifacts.dir`, so the parent can reference it via
 * `ctx.artifacts.relativeHref(FAILURE_SCREENSHOT_FILENAME)` without
 * copying.
 */
export const FAILURE_SCREENSHOT_FILENAME = 'failure-screenshot.png';

interface SetupMessage {
  type: 'setup';
  /** Launch Chrome headed (no `--headless`): `--headed` CLI flag or resolved `playwrightOptions.headless: false`. */
  headed?: boolean;
  /** Extra chrome flags from the resolved `playwrightOptions.args`. */
  chromeArgs?: string[];
  /**
   * From the resolved `playwrightOptions.ignoreHTTPSErrors`. Defaults to true
   * (like every other engine): `--ignore-certificate-errors` is passed unless
   * this is explicitly false.
   */
  ignoreHTTPSErrors?: boolean;
}

interface SampleMessage {
  type: 'sample';
  sampleIndex: number;
  workerIndex: number;
  testFile: string | null;
  testName: string;
  targetUrl: string;
  options: LighthouseBenchmarkOptions;
}

interface DisposeMessage {
  type: 'dispose';
}

interface AbortMessage {
  type: 'abort';
}

type ParentMessage = SetupMessage | SampleMessage | DisposeMessage | AbortMessage;

/**
 * Set while a sample is in flight so the parent's `abort` IPC — sent when the
 * pool's hard timeout fires — can interrupt the current run. Aborting forces
 * the sample into its `catch` path, which stops + saves the screencast and
 * tags the error with `failureMediaName`, so the timed-out task surfaces the
 * video instead of the generic `task timeout` rejection. Null between samples,
 * so an abort that lands on an idle (reused) worker is a no-op.
 */
let abortCurrentSample: ((reason: Error) => void) | null = null;

class LighthouseWorkerSampler {
  private chrome: LaunchedChrome | null = null;
  private userDataDir: string | null = null;

  async setupBrowser(options: { headed?: boolean; chromeArgs?: string[]; ignoreHTTPSErrors?: boolean } = {}): Promise<void> {
    const chromeFlags = [
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ];
    // Same default as every other engine's `ignoreHTTPSErrors`: lax unless the
    // config explicitly asks for strict certificate checking.
    if (options.ignoreHTTPSErrors !== false) {
      chromeFlags.unshift('--ignore-certificate-errors');
    }
    // Headless unless the run opted into headed (the setup IPC message, set
    // from LighthouseBenchmarkOptions.headed / the resolved
    // playwrightOptions.headless).
    if (!options.headed) {
      chromeFlags.unshift('--headless');
    }

    // Extra flags from the resolved shared/perf playwrightOptions.args.
    chromeFlags.push(...(options.chromeArgs ?? []));

    if (process.env.TRACERBENCH_PROXY_URL) {
      chromeFlags.push(`--proxy-server=${process.env.TRACERBENCH_PROXY_URL}`);
    }

    this.userDataDir = await mkdtemp(join(tmpdir(), 'lighthouse-'));
    try {
      this.chrome = await launch({ chromeFlags, userDataDir: this.userDataDir });
    } catch (err) {
      const userDataDir = this.userDataDir;
      this.userDataDir = null;
      if (userDataDir) {
        await rm(userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        }).catch(() => undefined);
      }
      throw err;
    }
  }

  async dispose(): Promise<void> {
    const chrome = this.chrome;
    const userDataDir = this.userDataDir;
    this.chrome = null;
    this.userDataDir = null;

    // Run both cleanups regardless of whether one throws: a hung Chrome that
    // can't be killed must not stop us from removing the tmp userDataDir,
    // otherwise long runs leak GBs of /tmp.
    const errors: Error[] = [];
    try {
      await chrome?.kill();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
    if (userDataDir) {
      try {
        await rm(userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new Error(
        `Multiple Lighthouse worker dispose failures: ${errors.map((e) => e.message).join('; ')}`,
      );
    }
  }

  async getMobileSettings(): Promise<LighthouseConfig> {
    // Route through importPatchedLighthouse so we fail before runLighthouse
    // if the loader hook didn't apply — otherwise the run produces a vanilla
    // trace that silently excludes post-load testFn interactions.
    const { defaultConfig } = await importPatchedLighthouse();
    // Throttling comes from DEFAULT_LH_CONFIG (Slow 4G); a user's
    // `lighthouseConfig` overlays it at the call site.
    return {
      ...defaultConfig?.settings,
      ...DEFAULT_LH_CONFIG,
      port: this.chrome!.port,
    };
  }

  async sample(
    sampleState: unknown,
    sampleIndex: number,
  ): Promise<NavigationSample> {
    const msg = assertSampleMessage(sampleState, sampleIndex);
    const testDef = await resolveTestDef(msg.testFile, msg.testName);
    const saveArtifacts = msg.options.saveArtifacts ?? true;
    let lhSettings = await this.getMobileSettings();

    lhSettings = { ...lhSettings, ...msg.options.lhConfig, port: this.chrome!.port };

    const markers = testDef.markers ?? msg.options.markers;
    const { phases, accessibilityScore } = await this.runLighthouseWithPlaywright(
      testDef,
      msg.options,
      msg.targetUrl,
      lhSettings,
      markers,
      `sample-${sampleIndex}`,
      saveArtifacts,
    );
    return makeNavigationSample(phases, accessibilityScore);
  }

  private async runLighthouseWithPlaywright(
    testDef: AbTestDefinition,
    options: LighthouseBenchmarkOptions,
    url: string,
    lhSettings: LighthouseConfig,
    markers: LighthouseBenchmarkOptions['markers'],
    sampleLabel: string,
    saveArtifacts: boolean,
  ): Promise<{ phases: PhaseSample[]; accessibilityScore: number | null }> {
    const browser = await chromium.connectOverCDP(`http://localhost:${this.chrome!.port}`);
    let livePage: Page | null = null;
    const resultsFolder = options.resultsFolder ?? './tracerbench-results';

    // Abort hook: the parent sends `{ type: 'abort' }` when the pool's hard
    // timeout fires. We reject `abortSignal`, which (raced against the run
    // below) drops us into the `catch` so the screencast is stopped, saved,
    // and attached as `failureMediaName`. Cleared in the `finally` so a stray
    // abort can't fire into the next sample on this reused worker.
    let rejectOnAbort: ((reason: Error) => void) | null = null;
    const abortSignal = new Promise<never>((_, reject) => {
      rejectOnAbort = reject;
    });
    // Pre-attach a no-op rejection handler so that if abort fires on the happy
    // path (after the run already settled) the rejection isn't "unhandled".
    abortSignal.catch(() => {});
    abortCurrentSample = (reason) => rejectOnAbort?.(reason);

    // Best-effort still screenshot of the live browser for the failure report,
    // taken before teardown. Returns the filename written, or null. `livePage`
    // may be null if lighthouse rejected before waitForPage; fall back to
    // whatever page the context still has.
    const captureFailureScreenshot = async (): Promise<string | null> => {
      const resultsFolder = options.resultsFolder;
      const page = livePage ?? browser.contexts()[0]?.pages()[0] ?? null;
      if (!resultsFolder || !page) return null;
      try {
        await page.screenshot({
          path: join(resultsFolder, FAILURE_SCREENSHOT_FILENAME),
          fullPage: true,
          timeout: 3000,
        });
        return FAILURE_SCREENSHOT_FILENAME;
      } catch (err) {
        console.warn(
          `[shaka-perf failure-screenshot] capture failed for ${sampleLabel}: ${(err as Error).message}`,
        );
        return null;
      }
    };

    try {
      const context = browser.contexts()[0];
      // Fork boundary: the parent's `ctx.config` (functions and all) can't cross,
      // so rebuild this test's effective config here and read from it.
      const config = await reconstructEffectiveConfig(testDef);
      // The shared clear → beforeNavigate sequence, run on the context before
      // Lighthouse navigates so route-blocking/init-scripts cover the first
      // navigation and subframes. This context is reused across samples, so the
      // clear is what enforces per-sample isolation.
      await setUpContextForNavigation({
        context,
        url,
        viewport: options.viewport,
        isControl: options.isControl ?? false,
        testType: 'perf',
        beforeNavigate: config.shared.beforeNavigate,
      });

      let releaseTracking: () => void = () => {};
      const canStopTracking = new Promise<void>((resolve) => {
        releaseTracking = resolve;
      });

      const timestamp = new Date();
      console.log(
        `[shaka-perf timing] subprocess Lighthouse start at ${timestamp.toISOString()} ` +
        `(epochMs=${timestamp.getTime()}, pid=${process.pid}, ${sampleLabel})`
      );
      // `compare` (perf bench) leaves captureAuditArtifacts unset so it
      // skips the interaction recorder (no real-typing slowdown) AND the
      // screencast capture. Only the audit pipeline opts in.
      const captureAuditArtifacts = options.captureAuditArtifacts ?? false;

      // RECORD: arm the screencast for this sample (or disarm it — `compare`
      // perf bench leaves captureAuditArtifacts unset, so it records nothing and
      // `stop()`/`save()` below are no-ops). Everything else — starting capture
      // at navigationStart, auto-cutting at LH's measured-window boundary, and
      // resetting state so nothing leaks into the next sample on this worker —
      // lives inside the recorder singleton.
      screencastRecorder.record(captureAuditArtifacts);

      // The on-page interaction overlay annotates the screencast, so it's an
      // audit-only artifact. `compare` (perf bench) skips it — an init script on
      // the measured page would perturb perf fidelity, and there's no screencast
      // to annotate anyway. It's unaffected by the clear above (init scripts
      // survive it); it just has to be in place before navigation.
      if (captureAuditArtifacts) await attachInteractionOverlay(context);

      const group = options.isControl ? 'control' : 'experiment';
      const lighthousePromise = runLighthouse(
        group,
        url,
        lhSettings,
        resultsFolder,
        saveArtifacts,
        canStopTracking,
      );

      const page = await this.waitForPage(context, url);
      livePage = page;
      await injectINPObserver(page);
      const recorder = captureAuditArtifacts ? createInteractionRecorder() : null;
      if (recorder) await recorder.attach(page);
      // Emit the timeline `performance.mark` for an annotation. The page can
      // be torn down concurrently (navigation, or Lighthouse's audit phase
      // closing the CDP target) — page.evaluate then rejects. A test author
      // writing `annotate('x')` without `await` would surface that as an
      // unhandled rejection and could kill the worker, so swallow + warn: the
      // only visible effect is the missing timeline mark.
      const markAnnotation = async (label: string): Promise<void> => {
        try {
          await page.evaluate(
            ({ prefix, l }) => { performance.mark(prefix + l); },
            { prefix: SHAKA_PERF_ANNOTATION_PREFIX, l: label },
          );
        } catch (err) {
          console.warn(`annotate(${JSON.stringify(label)}) failed: ${(err as Error).message}`);
        }
      };
      // `createTestAnnotate` records the latest label in framework state; the
      // worker's sample boundary attaches that label to any thrown error before
      // sending it over IPC. The engine-specific side effect (timeline mark)
      // rides along as `markAnnotation`.
      const playwrightPromise = testDef.testFn({
        page,
        browserContext: context,
        isControl: options.isControl ?? false,
        scenario: testDef,
        viewport: options.viewport,
        testType: 'perf',
        annotate: createTestAnnotate(markAnnotation),
      })
        .then(() => collectINP(page))
        // Drain istanbul coverage before we let Lighthouse finish (which
        // tears down the page CDP target) — afterwards page.evaluate()
        // rejects with a "Target page, context or browser has been
        // closed"-style error. `window.__coverage__` is populated by
        // babel-plugin-istanbul; an uninstrumented bundle isn't a hard error
        // but it isn't silent either, since the audit pipeline opts in via
        // `captureCoverage: true`.
        .then(async (inp) => {
          if (options.captureCoverage && options.resultsFolder) {
            await captureWindowCoverage(page, options.resultsFolder, url);
          }
          return inp;
        })
        // testFn settled (resolved or threw): release Lighthouse's gather-hold
        // so it can finish measuring. We do NOT cut the screencast here — that
        // happens in `__shakaperfOnMeasuringDone` the instant LH's measured
        // window actually ends (releaseTracking only lifts one of LH's
        // load-gate conditions; LH then still waits for CPU-idle and keeps the
        // trace running). The encode happens once the run resolves.
        .finally(() => {
          releaseTracking();
        });

      // Abandon (don't await) the underlying work if abort wins the race;
      // attach no-op catches so their eventual rejection — once the browser is
      // torn down in `finally` — doesn't surface as an unhandled rejection and
      // kill the worker via `reportFatal`.
      void lighthousePromise.catch(() => {});
      void playwrightPromise.catch(() => {});
      const [{ phases, runnerResult }, inp] = await Promise.race([
        Promise.all([lighthousePromise, playwrightPromise]),
        abortSignal,
      ]);

      if (saveArtifacts && captureAuditArtifacts && recorder) {
        writeFileSync(
          join(resultsFolder, `${group}_interactions.json`),
          JSON.stringify(recorder.interactions, null, 2),
        );
      }
      // STOP then SAVE: stop joins the in-flight auto-cut (or cuts now if LH's
      // measuring boundary was never reached), and save encodes the frozen
      // frames to screencast.mp4. No-ops when this sample didn't record.
      await screencastRecorder.stop();
      await screencastRecorder.save(resultsFolder, sampleLabel);
      if (captureAuditArtifacts && !existsSync(join(resultsFolder, SCREENCAST_FILENAME))) {
        throw new Error(
          `[shaka-perf screencast] recording failed for ${sampleLabel}: ${SCREENCAST_FILENAME} was not written`,
        );
      }

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

      // Off `phases` so perf metrics stay byte-identical (null on compare).
      const accessibilityScore = accessibilityScoreFromLhr(runnerResult.lhr);

      return { phases, accessibilityScore };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('[shaka-perf screencast]')) throw err;
      // STOP cuts the recording at the throw (on failure LH's measuring boundary
      // usually never arrives, so the auto-cut hasn't fired). Then surface the
      // richer media: the video if SAVE captured frames, else a still screenshot
      // (best-effort, before the outer `finally` tears the browser down) — only
      // captured as the fallback, since a full-page screenshot isn't free and is
      // discarded when the video won. The chosen filename rides `err` to the
      // parent's IPC handler, where the perf/audit stages turn it into a
      // StageFailureError; the latest test annotation is forwarded separately
      // as plain IPC metadata.
      await screencastRecorder.stop();
      const videoSaved = await screencastRecorder.save(resultsFolder, sampleLabel);
      const mediaName = videoSaved ? SCREENCAST_FILENAME : await captureFailureScreenshot();
      // A non-Error throw (a string, or a rejected POJO from a test or LH
      // internals) can't carry `failureMediaName` as a property, which would
      // drop the just-encoded video/screenshot from the report. Normalize to an
      // Error so the captured media always rides to the parent's IPC handler.
      // The Error case keeps the original reference, preserving metadata.
      const error = err instanceof Error ? err : new Error(String(err));
      if (mediaName) {
        (error as Error & { failureMediaName?: string }).failureMediaName = mediaName;
      }
      throw error;
    } finally {
      abortCurrentSample = null;
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
    throw new Error(`Timed out waiting for page at ${url}`);
  }
}


async function captureWindowCoverage(
  page: Page,
  resultsFolder: string,
  url: string,
): Promise<void> {
  let coverage: unknown;
  try {
    coverage = await page.evaluate(
      () => (globalThis as { __coverage__?: unknown }).__coverage__,
    );
  } catch (err) {
    console.warn(
      `[shaka-perf coverage] page.evaluate(__coverage__) failed for ${url}: ${(err as Error).message}`,
    );
    return;
  }
  if (!coverage || typeof coverage !== 'object') {
    // Bundle isn't instrumented. The caller (audit pipeline) explicitly opted
    // in, so stay loud — silently skipping leaves users staring at an empty
    // coverage report with no idea why.
    console.warn(
      `[shaka-perf coverage] window.__coverage__ missing on ${url}. ` +
        'Coverage was requested but the served bundle is not instrumented — ' +
        'add babel-plugin-istanbul to the build (or nyc instrument the served JS).',
    );
    return;
  }
  try {
    writeFileSync(join(resultsFolder, 'coverage.json'), JSON.stringify(coverage));
  } catch (err) {
    console.warn(
      `[shaka-perf coverage] failed to write coverage.json to ${resultsFolder}: ${(err as Error).message}`,
    );
  }
}

function assertSampleMessage(value: unknown, sampleIndex: number): SampleMessage {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as SampleMessage).type === 'sample' &&
    (value as SampleMessage).sampleIndex === sampleIndex &&
    typeof (value as SampleMessage).testName === 'string' &&
    typeof (value as SampleMessage).targetUrl === 'string' &&
    typeof (value as SampleMessage).options === 'object' &&
    (value as SampleMessage).options !== null
  ) {
    return value as SampleMessage;
  }
  throw new Error('Invalid Lighthouse sample message');
}

/**
 * Per-subprocess cache of test definitions, keyed by absolute test file
 * path. The worker subprocess is long-lived (reused across many samples
 * for the same test+viewport), but `tsx/esm/api`'s `tsImport` can't be
 * reliably forced to re-execute a previously-loaded module even with a
 * query-string cache-bust — so the second sample on the same subprocess
 * would otherwise hit an empty registry and fail with "Test not found".
 * The test file's contents don't change mid-run, so a one-shot load per
 * subprocess is both correct and faster than re-loading every sample.
 * See packages/shaka-shared/src/load-tests.ts for the same workaround on
 * the parent-process side.
 */
const testDefsByFile = new Map<string, AbTestDefinition[]>();

async function resolveTestDef(
  testFile: string | null,
  testName: string,
): Promise<AbTestDefinition> {
  if (!testFile) {
    throw new Error(`Cannot sample "${testName}" because its source file is unknown`);
  }
  let tests = testDefsByFile.get(testFile);
  if (!tests) {
    tests = await loadTestDefinitions(testFile);
    testDefsByFile.set(testFile, tests);
  }
  const testDef = tests.find((t) => t.name === testName && t.file === testFile) ??
    tests.find((t) => t.name === testName);
  if (!testDef) {
    throw new Error(`Test "${testName}" not found in ${testFile}`);
  }
  return testDef;
}

async function loadTestDefinitions(testFile: string): Promise<AbTestDefinition[]> {
  clearRegistry();
  try {
    await loadTestFile(testFile);
    return getRegisteredTests();
  } finally {
    clearRegistry();
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
  sendErrorFrame({ type: 'error', message: error.message, stack: error.stack ?? '' });
  void shutdown(1);
}
process.on('unhandledRejection', reportFatal);
process.on('uncaughtException', reportFatal);

let sampler: LighthouseWorkerSampler | null = null;
let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sampler?.dispose();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    sendErrorFrame({
      type: 'error',
      message: `Failed to dispose Lighthouse worker sampler: ${error.message}`,
      stack: error.stack ?? '',
    });
  } finally {
    process.exit(exitCode);
  }
}

installBeforePageNavigateBarrier();

function logSampleStart(msg: SampleMessage): void {
  const timestamp = new Date();
  const sampleLabel = `sample-${msg.sampleIndex}`;
  console.log(
    `[shaka-perf timing] subprocess sample command received at ${timestamp.toISOString()} ` +
    `(epochMs=${timestamp.getTime()}, pid=${process.pid}, ${sampleLabel}, workerIndex=${msg.workerIndex})`
  );
}

process.on('message', async (msg: ParentMessage) => {
  if (shuttingDown) return;
  if (msg.type === 'setup') {
    try {
      const workerSampler = new LighthouseWorkerSampler();
      sampler = workerSampler;
      // Forward every launch option off the message rather than cherry-picking
      // fields: each one is optional, so an omission type-checks and silently
      // reverts that option to its default in the worker (this is exactly how
      // `ignoreHTTPSErrors` came to be ignored by Lighthouse alone while every
      // other engine honoured it). Destructuring `type` off leaves precisely
      // the launch options, and a new one reaches the browser for free.
      const { type: _type, ...launchOptions } = msg;
      await workerSampler.setupBrowser(launchOptions);
      if (shuttingDown) return;
      send({ type: 'ready' });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      sendErrorFrame({ type: 'error', message: error.message, stack: error.stack ?? '' });
      await shutdown(1);
    }
  } else if (msg.type === 'sample') {
    try {
      if (!sampler) throw new Error('lighthouse worker received sample before setup completed');
      const activeSampler = sampler;
      logSampleStart(msg);
      const sample = await runWithTestAnnotationContext(() => activeSampler.sample(msg, msg.sampleIndex));
      send({ type: 'result', sample });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const failureMediaName = (err as { failureMediaName?: unknown })?.failureMediaName;
      // Forward framework annotation metadata explicitly; the class/prototype
      // identity does not survive the IPC boundary.
      const lastAnnotation = getLatestTestAnnotation(err);
      sendErrorFrame({
        type: 'error',
        message: error.message,
        stack: error.stack ?? '',
        ...(typeof failureMediaName === 'string' ? { failureMediaName } : {}),
        ...(typeof lastAnnotation === 'string' ? { lastAnnotation } : {}),
      });
    }
  } else if (msg.type === 'abort') {
    // Pool hard-timeout: interrupt the in-flight sample so it runs its catch
    // path (stop + save the screencast, attach failureMediaName) and replies
    // with a rich error frame the parent can surface within its grace window.
    // No-op when no sample is running (hook is null between samples).
    abortCurrentSample?.(new Error('sample aborted after pool task timeout'));
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
