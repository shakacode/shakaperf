import * as path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright-core';
import { runBeforeNavigateHooks } from '../../../before-navigate';
import { clearBrowserData } from '../../../bench/core/clear-browser-data';
import { bufferToAvifDataUri } from '../../../pipeline/artifact-compression';
import { toPosixRelative } from '../../../pipeline/path-utils';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import {
  getLatestTestAnnotation,
  messageWithLatestTestAnnotation,
  runWithLastAnnotation,
} from '../../../test-annotation';
import { scanLandedOnBotWall } from '../../../audit/bot-wall';
import { applyRealChrome, realChromeMobileEmulation, waitForBotWallToClear } from '../../../audit/real-chrome';
import {
  accessibilityConfigForTest,
  type AccessibilityEffectiveConfig,
  type AccessibilityStageConfig,
} from '../../../audit/stages/accessibility/config';
import { normalizeViolation } from '../../../audit/stages/accessibility/artifacts';
import type {
  AccessibilityNodeBounds,
  AccessibilityViolation,
} from '../../../audit/stages/accessibility/types';
import type {
  AccessibilityCompareFinding,
  AccessibilityCompareResult,
  AccessibilityCompareSide,
  AccessibilityCompareSummary,
  AccessibilityFindingSide,
  AccessibilitySideScan,
} from './types';

interface AccessibilityCompareSlotState extends PoolWorkerState {
  accessibilityCompareBrowser?: Browser;
}

type PageGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;
const MAX_NODE_HTML_CHARS = 500;
const MAX_NODE_FAILURE_SUMMARY_CHARS = 2000;

async function disposeAccessibilityCompareBrowser(state: Record<string, unknown>): Promise<void> {
  const slot = state as AccessibilityCompareSlotState;
  const browser = slot.accessibilityCompareBrowser;
  if (!browser) return;
  slot.accessibilityCompareBrowser = undefined;
  await browser.close().catch(() => {});
}

export async function runAccessibilityCompareStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: AccessibilityStageConfig,
): Promise<AccessibilityCompareResult> {
  return workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<AccessibilityCompareSlotState>(
      state,
      disposeAccessibilityCompareBrowser,
    );
    if (!slot.accessibilityCompareBrowser) {
      slot.accessibilityCompareBrowser = await launchBrowser(config, ctx.runtime.headed);
    }
    return scanAccessibilityComparison(ctx, slot.accessibilityCompareBrowser, config);
  }, { key: `${ctx.testAndViewportId}:accessibility` });
}

async function launchBrowser(config: AccessibilityStageConfig, headed = false): Promise<Browser> {
  const engine = config.engineOptions.browser ?? 'chromium';
  const launchOptions: LaunchOptions = {
    headless: headed ? false : config.engineOptions.headless ?? true,
    args: config.engineOptions.args,
  };
  if (engine === 'firefox') return firefox.launch(launchOptions);
  if (engine === 'webkit') return webkit.launch(launchOptions);
  return chromium.launch(applyRealChrome(launchOptions));
}

async function scanAccessibilityComparison(
  ctx: TestContext,
  browser: Browser,
  config: AccessibilityStageConfig,
): Promise<AccessibilityCompareResult> {
  const effective = accessibilityConfigForTest(config, ctx.test);
  const [control, experiment] = await Promise.all([
    scanSide(ctx, browser, effective, config, 'control', ctx.controlURL),
    scanSide(ctx, browser, effective, config, 'experiment', ctx.experimentURL),
  ]);
  const findings = control.error || experiment.error || control.blocked || experiment.blocked
    ? []
    : compareScans(control, experiment);
  const result = projectCompareResultForReport({
    control,
    experiment,
    effectiveConfig: {
      tags: effective.tags,
      disableRules: effective.disableRules,
      includeRules: effective.includeRules,
    },
    failOnViolation: config.failOnViolation,
    findings,
    summary: summarizeFindings(findings, control, experiment),
  });
  await ctx.artifacts.writeJson('accessibility-comparison.json', result);
  result.comparisonArtifactHref = relativeArtifactHref(ctx, 'accessibility-comparison.json');
  return result;
}

async function scanSide(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
  side: AccessibilityCompareSide,
  url: string,
): Promise<AccessibilitySideScan> {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      viewport: {
        width: ctx.viewport.width,
        height: ctx.viewport.height,
      },
      deviceScaleFactor: ctx.viewport.deviceScaleFactor,
      isMobile: ctx.viewport.formFactor === 'mobile',
      // Real-Chrome only: serve the phone layout (no-op headless).
      ...realChromeMobileEmulation(ctx.viewport.formFactor),
    });
    page = await context.newPage();
    if (config.engineOptions.waitTimeout) {
      page.setDefaultTimeout(config.engineOptions.waitTimeout);
      page.setDefaultNavigationTimeout(config.engineOptions.waitTimeout);
    }
    await preparePageForAccessibilitySide(page, context, ctx, config, side, url);

    let builder = new AxeBuilder({ page });
    if (effective.includeRules && effective.includeRules.length > 0) {
      builder = builder.withRules(effective.includeRules);
    } else {
      if (effective.tags.length > 0) builder = builder.withTags(effective.tags);
      if (effective.disableRules.length > 0) builder = builder.disableRules(effective.disableRules);
    }

    const results = await builder.analyze();
    const violations = results.violations.map(normalizeViolation);
    await attachNodeBounds(page, violations);
    const screenshot = await captureScreenshot(ctx, page, side);
    const probe = await page
      .evaluate(() => ({ title: document.title, html: document.documentElement.outerHTML.slice(0, 4000) }))
      .catch(() => ({ title: '', html: '' }));
    const blocked = scanLandedOnBotWall(probe, screenshot?.height, ctx.viewport.height);
    const rawFilename = `${side}-accessibility-report.json`;
    await ctx.artifacts.writeJson(rawFilename, {
      side,
      testName: ctx.test.name,
      url: results.url ?? url,
      blocked,
      effectiveConfig: {
        tags: effective.tags,
        disableRules: effective.disableRules,
        includeRules: effective.includeRules,
      },
      axe: results,
    });
    return {
      side,
      url: results.url ?? url,
      rawArtifactHref: relativeArtifactHref(ctx, rawFilename),
      screenshot,
      violations,
      blocked,
    };
  } catch (err) {
    const screenshot = page ? await captureScreenshotIfPossible(ctx, page, `${side}-failure`) : undefined;
    const error = messageWithLatestTestAnnotation(
      (err as Error).message || String(err),
      getLatestTestAnnotation(err),
    );
    const rawFilename = `${side}-accessibility-error.json`;
    await ctx.artifacts.writeJson(rawFilename, {
      side,
      testName: ctx.test.name,
      url,
      error,
    }).catch(() => {});
    return {
      side,
      url,
      rawArtifactHref: relativeArtifactHref(ctx, rawFilename),
      screenshot,
      violations: [],
      error,
    };
  } finally {
    await context?.close().catch(() => {});
  }
}

async function preparePageForAccessibilitySide(
  page: Page,
  context: BrowserContext,
  ctx: TestContext,
  config: AccessibilityStageConfig,
  side: AccessibilityCompareSide,
  url: string,
): Promise<void> {
  await context.clearCookies();
  await runBeforeNavigateHooks(
    {
      context,
      page,
      url,
      viewport: ctx.viewport,
      isControl: side === 'control',
      testType: 'accessibility',
    },
    ctx.test.options.beforeNavigate,
  );
  await clearBrowserData(context, url);
  await page.goto(url, accessibilityGotoOptions(config));
  await waitForBotWallToClear(page);
  await runWithLastAnnotation((annotate) =>
    ctx.test.testFn({
      page,
      browserContext: context,
      isControl: side === 'control',
      scenario: ctx.test,
      viewport: ctx.viewport,
      testType: 'accessibility',
      annotate,
    }),
  );
}

function accessibilityGotoOptions(config: AccessibilityStageConfig): PageGotoOptions {
  const candidate = config.engineOptions.gotoParameters;
  if (candidate && typeof candidate === 'object') {
    return candidate as PageGotoOptions;
  }
  return { waitUntil: 'networkidle' };
}

async function captureScreenshot(
  ctx: TestContext,
  page: Page,
  prefix: string,
): Promise<AccessibilitySideScan['screenshot']> {
  const filename = `${prefix}-accessibility-screenshot.png`;
  const shot = await page.screenshot({
    type: 'png',
    fullPage: true,
    scale: 'css',
  });
  await ctx.artifacts.writeFile(filename, shot);
  const meta = await sharp(shot).metadata();
  const width = meta.width ?? ctx.viewport.width;
  const height = meta.height ?? ctx.viewport.height;
  const scale = Math.min(1, 960 / Math.max(1, width));
  let imageDataUri: string | undefined;
  try {
    imageDataUri = await bufferToAvifDataUri(shot, 45, scale);
  } catch (err) {
    console.warn(
      `[shaka-perf compare a11y] inline screenshot encode failed (${width}x${height}px); ` +
        `card will render without crop frames: ${(err as Error).message}`,
    );
  }
  return {
    width,
    height,
    imageHref: relativeArtifactHref(ctx, filename),
    imageDataUri,
  };
}

async function captureScreenshotIfPossible(
  ctx: TestContext,
  page: Page,
  prefix: string,
): Promise<AccessibilitySideScan['screenshot'] | undefined> {
  try {
    return await captureScreenshot(ctx, page, prefix);
  } catch {
    return undefined;
  }
}

async function attachNodeBounds(page: Page, violations: AccessibilityViolation[]): Promise<void> {
  const targets = violations.flatMap((violation) => violation.nodes.map((node) => node.target));
  if (targets.length === 0) return;
  let boxes: (AccessibilityNodeBounds | null)[];
  try {
    boxes = await page.evaluate((targetList): (AccessibilityNodeBounds | null)[] => {
      const sx = window.scrollX;
      const sy = window.scrollY;
      const r2 = (value: number): number => Math.round(value * 100) / 100;
      return targetList.map((target): AccessibilityNodeBounds | null => {
        // length > 1 = iframe descent; querySelector can't cross frames, so skip.
        if (!Array.isArray(target) || target.length !== 1) return null;
        const segment = target[0];
        // string[] segment = shadow-DOM path (pierce each open shadow root).
        const steps = typeof segment === 'string' ? [segment] : Array.isArray(segment) ? segment : [];
        let element: Element | null = null;
        let scope: Document | ShadowRoot = document;
        for (let i = 0; i < steps.length; i += 1) {
          const step = steps[i];
          if (!step) { element = null; break; }
          let found: Element | null = null;
          try { found = scope.querySelector(step); } catch { found = null; }
          if (!found) { element = null; break; }
          element = found;
          if (i < steps.length - 1) {
            // Intermediate step must descend a shadow root; if none, bail.
            if (!found.shadowRoot) { element = null; break; }
            scope = found.shadowRoot;
          }
        }
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: r2(rect.x + sx), y: r2(rect.y + sy), width: r2(rect.width), height: r2(rect.height) };
      });
    }, targets);
  } catch {
    return;
  }
  let index = 0;
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const bounds = boxes[index];
      index += 1;
      if (bounds) node.bounds = bounds;
    }
  }
}

interface GroupedFinding {
  ruleId: string;
  side: AccessibilityFindingSide;
}

export function compareScans(
  control: AccessibilitySideScan,
  experiment: AccessibilitySideScan,
): AccessibilityCompareFinding[] {
  const controlMap = groupViolations(control.violations);
  const experimentMap = groupViolations(experiment.violations);
  const signatures = [...new Set([...controlMap.keys(), ...experimentMap.keys()])].sort();
  return signatures.map((signature) => {
    const controlEntry = controlMap.get(signature);
    const experimentEntry = experimentMap.get(signature);
    const ruleId = experimentEntry?.ruleId ?? controlEntry!.ruleId;
    const status = !controlEntry
      ? 'new'
      : !experimentEntry
        ? 'fixed'
        : findingChanged(controlEntry.side, experimentEntry.side)
          ? 'changed'
          : 'unchanged';
    const impact = experimentEntry?.side.impact ?? controlEntry?.side.impact ?? null;
    const tags = sortedUnique([
      ...(controlEntry?.side.tags ?? []),
      ...(experimentEntry?.side.tags ?? []),
    ]);
    return {
      status,
      signature,
      ruleId,
      impact,
      tags,
      ...(controlEntry ? { control: controlEntry.side } : {}),
      ...(experimentEntry ? { experiment: experimentEntry.side } : {}),
    };
  });
}

function groupViolations(violations: AccessibilityViolation[]): Map<string, GroupedFinding> {
  const grouped = new Map<string, GroupedFinding>();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const signature = `${violation.ruleId}|${targetKey(node.target)}`;
      const existing = grouped.get(signature);
      const side = existing?.side ?? {
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: [],
        nodes: [],
      };
      side.impact = worstImpact(side.impact, violation.impact);
      side.tags = sortedUnique([...side.tags, ...violation.tags]);
      side.nodes.push({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
        ...(node.bounds ? { bounds: node.bounds } : {}),
      });
      grouped.set(signature, {
        ruleId: violation.ruleId,
        side,
      });
    }
  }
  return grouped;
}

function findingChanged(control: AccessibilityFindingSide, experiment: AccessibilityFindingSide): boolean {
  return control.impact !== experiment.impact ||
    control.nodes.length !== experiment.nodes.length ||
    normalizedNodePayload(control.nodes) !== normalizedNodePayload(experiment.nodes);
}

function normalizedNodePayload(nodes: AccessibilityFindingSide['nodes']): string {
  return JSON.stringify(nodes.map((node) => ({
    html: normalizeText(node.html),
    failureSummary: normalizeText(node.failureSummary),
  })).sort((a, b) =>
    a.html.localeCompare(b.html) || a.failureSummary.localeCompare(b.failureSummary),
  ));
}

function targetKey(target: AccessibilityViolation['nodes'][number]['target']): string {
  return JSON.stringify(target.map((segment) =>
    Array.isArray(segment) ? segment.map(normalizeText) : normalizeText(segment),
  ));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function summarizeFindings(
  findings: AccessibilityCompareFinding[],
  control: AccessibilitySideScan,
  experiment: AccessibilitySideScan,
): AccessibilityCompareSummary {
  const summary: AccessibilityCompareSummary = {
    new: 0,
    fixed: 0,
    changed: 0,
    unchanged: 0,
    errors: (control.error ? 1 : 0) + (experiment.error ? 1 : 0),
    blocked: (control.blocked ? 1 : 0) + (experiment.blocked ? 1 : 0),
    newByImpact: {},
    fixedByImpact: {},
    changedByImpact: {},
  };
  for (const finding of findings) {
    if (finding.status === 'new') {
      summary.new += 1;
      incrementImpact(summary.newByImpact, finding.impact);
    } else if (finding.status === 'fixed') {
      summary.fixed += 1;
      incrementImpact(summary.fixedByImpact, finding.impact);
    } else if (finding.status === 'changed') {
      summary.changed += 1;
      incrementImpact(summary.changedByImpact, finding.impact);
    } else {
      summary.unchanged += 1;
    }
  }
  return summary;
}

export function projectCompareResultForReport(
  result: AccessibilityCompareResult,
): AccessibilityCompareResult {
  return {
    ...result,
    control: projectSideForReport(result.control),
    experiment: projectSideForReport(result.experiment),
    findings: result.findings.map((finding) => ({
      ...finding,
      ...(finding.control ? { control: projectFindingSideForReport(finding.control) } : {}),
      ...(finding.experiment ? { experiment: projectFindingSideForReport(finding.experiment) } : {}),
    })),
  };
}

function projectSideForReport(side: AccessibilitySideScan): AccessibilitySideScan {
  return {
    ...side,
    violations: side.violations.map((violation) => ({
      ...violation,
      nodes: violation.nodes.map((node) => ({
        ...node,
        html: truncate(node.html, MAX_NODE_HTML_CHARS),
        failureSummary: truncate(node.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
      })),
    })),
  };
}

function projectFindingSideForReport(side: AccessibilityFindingSide): AccessibilityFindingSide {
  return {
    ...side,
    nodes: side.nodes.map((node) => ({
      ...node,
      html: truncate(node.html, MAX_NODE_HTML_CHARS),
      failureSummary: truncate(node.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
    })),
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated from ${value.length} chars]`;
}

function incrementImpact(target: Record<string, number>, impact: AccessibilityCompareFinding['impact']): void {
  const key = impact ?? 'unknown';
  target[key] = (target[key] ?? 0) + 1;
}

function worstImpact(
  a: AccessibilityViolation['impact'],
  b: AccessibilityViolation['impact'],
): AccessibilityViolation['impact'] {
  return impactRank(b) < impactRank(a) ? b : a;
}

function impactRank(impact: AccessibilityViolation['impact']): number {
  if (impact === 'critical') return 0;
  if (impact === 'serious') return 1;
  if (impact === 'moderate') return 2;
  if (impact === 'minor') return 3;
  return 4;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function relativeArtifactHref(ctx: TestContext, filename: string): string {
  return toPosixRelative(ctx.runtime.resultsRoot, path.join(ctx.artifacts.dir, filename));
}
