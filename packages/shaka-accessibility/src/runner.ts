import * as fs from 'node:fs';
import * as path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { ImpactValue, NodeResult, Result } from 'axe-core';
import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright';
import {
  TestType,
  type AbTestAxeConfig,
  type AbTestDefinition,
  type Viewport,
} from 'shaka-shared';
import {
  mergeAxeConfig,
  type AxeEffectiveConfig,
  type AxeGlobalConfig,
} from './config';
import type { AxeRunArtifact, AxeRunResult, AxeScan, AxeViolation } from './types';

export interface RunAxeOptions {
  tests: AbTestDefinition[];
  globalConfig: AxeGlobalConfig;
  experimentURL: string;
  resultsRoot: string;
  /** Optional logger; defaults to console.log. */
  log?: (message: string) => void;
}

export interface RunAxeResult {
  results: AxeRunResult[];
  /** Total number of violations across every non-skipped scan. */
  totalViolations: number;
  /** Number of tests whose run threw before producing an artifact. */
  errorCount: number;
  /**
   * Whether the browser failed to launch at all. When true, every test entry
   * in `results` carries the same `error` and no artifact files were written.
   */
  fatalLaunchError?: string;
}

/**
 * Slugify test name the same way `shaka-perf compare` does (see
 * `compare/harvest/perf.ts`). Keeping the output directory aligned means v2
 * harvest can read `<slug>/axe-report.json` from an existing compare layout.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function launchBrowser(config: AxeGlobalConfig): Promise<Browser> {
  const engine = config.engineOptions.browser ?? 'chromium';
  const launchOptions: LaunchOptions = {
    headless: config.engineOptions.headless ?? true,
    args: config.engineOptions.args,
  };
  switch (engine) {
    case 'firefox':
      return firefox.launch(launchOptions);
    case 'webkit':
      return webkit.launch(launchOptions);
    case 'chromium':
    default:
      return chromium.launch(launchOptions);
  }
}

function buildTargetURL(experimentURL: string, startingPath: string): string {
  return new URL(startingPath, experimentURL).href;
}

async function preparePage(
  page: Page,
  context: BrowserContext,
  test: AbTestDefinition,
  viewport: Viewport,
  url: string,
): Promise<void> {
  // Matches the minimum visreg preparePage semantics needed for an a11y scan:
  // navigate, then invoke the user's testFn so DOM state (auth, interactions,
  // ready-events) matches what visreg + perf would see.
  await page.goto(url, { waitUntil: 'networkidle' });

  if (test.testFn) {
    await test.testFn({
      page,
      browserContext: context,
      isReference: false,
      scenario: test,
      viewport,
      testType: TestType.Accessibility,
      // Per-test annotate() labels are only surfaced when the testFn throws —
      // keep the contract identical to visreg so tests can reuse annotations.
      annotate: () => {},
    });
  }
}

function normalizeViolation(result: Result): AxeViolation {
  return {
    ruleId: result.id,
    impact: (result.impact as ImpactValue | undefined) ?? null,
    help: result.help,
    helpUrl: result.helpUrl,
    nodes: result.nodes.map(normalizeNode),
  };
}

function normalizeNode(node: NodeResult): AxeViolation['nodes'][number] {
  return {
    // axe-core's target is `string | string[]` per node, wrapped in an outer
    // array for iframe/shadow descents — we preserve the outer array verbatim.
    target: Array.isArray(node.target) ? [...node.target] : [node.target],
    html: node.html,
    failureSummary: node.failureSummary ?? '',
  };
}

async function scanViewport(
  browser: Browser,
  test: AbTestDefinition,
  viewport: Viewport,
  url: string,
  effective: AxeEffectiveConfig,
): Promise<AxeScan> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  try {
    const page = await context.newPage();
    await preparePage(page, context, test, viewport, url);

    let builder = new AxeBuilder({ page });
    if (effective.includeRules && effective.includeRules.length > 0) {
      // Allowlist mode: ignore tags + disableRules — .withRules is an
      // explicit narrowing. Matches requirement 3.6.
      builder = builder.withRules(effective.includeRules);
    } else {
      if (effective.tags.length > 0) builder = builder.withTags(effective.tags);
      if (effective.disableRules.length > 0) builder = builder.disableRules(effective.disableRules);
    }

    const results = await builder.analyze();
    return {
      viewportLabel: viewport.label,
      viewport,
      url: results.url ?? url,
      violations: results.violations.map(normalizeViolation),
    };
  } finally {
    await context.close().catch(() => {
      /* closing a context that already closed is fine */
    });
  }
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Array<Promise<void>> = [];
  const workerCount = Math.max(1, Math.min(limit, items.length));
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

function writeArtifact(artifactPath: string, artifact: AxeRunArtifact): void {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
}

function writeEngineError(perTestDir: string, error: Error, output: string): void {
  fs.mkdirSync(perTestDir, { recursive: true });
  fs.writeFileSync(path.join(perTestDir, 'axe-engine-error.txt'), error.message);
  fs.writeFileSync(path.join(perTestDir, 'axe-engine-output.log'), output);
}

/**
 * Run axe against every test on the experiment server. See requirement 3.6 for
 * the one-browser-for-the-whole-run behavior and per-test failure isolation.
 */
export async function runAxe(options: RunAxeOptions): Promise<RunAxeResult> {
  const { tests, globalConfig, experimentURL, resultsRoot } = options;
  const log = options.log ?? ((m) => console.log(m));
  fs.mkdirSync(resultsRoot, { recursive: true });

  let browser: Browser;
  try {
    browser = await launchBrowser(globalConfig);
  } catch (err) {
    const message = (err as Error).message || String(err);
    log(`axe: browser launch failed — ${message}`);
    // Mirror the shape the caller expects even on a fatal failure so the CLI
    // can emit one error line per test rather than a single opaque crash.
    const fatal: RunAxeResult['results'] = tests.map((t) => ({
      testName: t.name,
      slug: slugify(t.name),
      artifactPath: '',
      skipped: false,
      totalViolations: 0,
      error: `axe engine aborted before launch: ${message}`,
    }));
    return { results: fatal, totalViolations: 0, errorCount: tests.length, fatalLaunchError: message };
  }

  const asyncLimit = globalConfig.engineOptions.asyncLimit ?? 2;
  const perTestTotals: RunAxeResult['results'] = [];
  let totalViolations = 0;
  let errorCount = 0;

  try {
    await runWithLimit(tests, asyncLimit, async (test) => {
      const slug = slugify(test.name);
      const perTestDir = path.join(resultsRoot, slug);
      const artifactPath = path.join(perTestDir, 'axe-report.json');
      const perTestAxe = (test.options?.axe ?? {}) as AbTestAxeConfig;
      const effective = mergeAxeConfig(globalConfig, perTestAxe);
      const url = buildTargetURL(experimentURL, test.startingPath);

      if (effective.skip) {
        const artifact: AxeRunArtifact = {
          testName: test.name,
          experimentURL: url,
          skipped: true,
          effectiveConfig: {
            tags: effective.tags,
            disableRules: effective.disableRules,
            includeRules: effective.includeRules,
            viewports: effective.viewports,
          },
          scans: [],
        };
        writeArtifact(artifactPath, artifact);
        perTestTotals.push({
          testName: test.name,
          slug,
          artifactPath,
          skipped: true,
          totalViolations: 0,
        });
        log(`axe: ${test.name} — skipped via options.axe.skip`);
        return;
      }

      const output: string[] = [];
      try {
        const scans: AxeScan[] = [];
        for (const viewport of effective.viewports) {
          const scan = await scanViewport(browser, test, viewport, url, effective);
          output.push(
            `[${viewport.label}] ${scan.violations.length} violation(s) against ${url}`,
          );
          scans.push(scan);
        }
        const violationCount = scans.reduce((sum, s) => sum + s.violations.length, 0);
        const artifact: AxeRunArtifact = {
          testName: test.name,
          experimentURL: url,
          skipped: false,
          effectiveConfig: {
            tags: effective.tags,
            disableRules: effective.disableRules,
            includeRules: effective.includeRules,
            viewports: effective.viewports,
          },
          scans,
        };
        writeArtifact(artifactPath, artifact);
        totalViolations += violationCount;
        perTestTotals.push({
          testName: test.name,
          slug,
          artifactPath,
          skipped: false,
          totalViolations: violationCount,
        });
        log(`axe: ${test.name} — ${violationCount} violation(s) across ${scans.length} viewport(s)`);
      } catch (err) {
        const error = err as Error;
        writeEngineError(perTestDir, error, output.join('\n'));
        errorCount++;
        perTestTotals.push({
          testName: test.name,
          slug,
          artifactPath,
          skipped: false,
          totalViolations: 0,
          error: error.message || String(error),
        });
        log(`axe: ${test.name} — ENGINE ERROR: ${error.message || error}`);
      }
    });
  } finally {
    await browser.close().catch(() => {
      /* ignore */
    });
  }

  return { results: perTestTotals, totalViolations, errorCount };
}
