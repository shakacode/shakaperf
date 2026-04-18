import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'playwright-core';
import type { AbTestDefinition } from 'shaka-shared';
import type { PerfConfig } from '../config';

export interface PerfMetricResult {
  label: string;
  controlMs: number;
  experimentMs: number;
  controlSamples: number[];
  experimentSamples: number[];
  hlDiffMs: number;
  pValue: number;
  significant: boolean;
}

export interface PerfRunOutput {
  metrics: PerfMetricResult[];
  errored: string | null;
}

interface RunOptions {
  test: AbTestDefinition;
  outDir: string;
  controlURL: string;
  experimentURL: string;
  perfConfig: PerfConfig;
  browser: Browser;
}

interface NavigationSampleRaw {
  domContentLoadedMs: number;
  loadEventMs: number;
  responseEndMs: number;
  firstContentfulPaintMs: number | null;
}

async function sample(browser: Browser, url: string): Promise<NavigationSampleRaw> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    bypassCSP: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    const raw = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0] as PerformanceEntry | undefined;
      if (!nav) return null;
      return {
        domContentLoadedMs: nav.domContentLoadedEventEnd - nav.startTime,
        loadEventMs: nav.loadEventEnd - nav.startTime,
        responseEndMs: nav.responseEnd - nav.startTime,
        firstContentfulPaintMs: fcp ? fcp.startTime : null,
      };
    });
    if (!raw) {
      throw new Error('no PerformanceNavigationTiming entry');
    }
    return raw;
  } finally {
    await context.close();
  }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[], xbar: number): number {
  if (xs.length < 2) return 0;
  let sum = 0;
  for (const x of xs) sum += (x - xbar) ** 2;
  return sum / (xs.length - 1);
}

// Welch's t-test → returns approximate two-sided p-value via a normal-tail
// approximation. Adequate for small N (~5-20) noise filtering. We avoid
// pulling in jstat for one number.
function welchPValue(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 1;
  const am = mean(a);
  const bm = mean(b);
  const av = variance(a, am);
  const bv = variance(b, bm);
  if (av + bv === 0) return 1;
  const se = Math.sqrt(av / a.length + bv / b.length);
  if (se === 0) return 1;
  const t = (am - bm) / se;
  // Two-sided p via standard normal complementary CDF approximation.
  const z = Math.abs(t);
  const p = 2 * (1 - normalCdf(z));
  return Math.max(0, Math.min(1, p));
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  const p =
    d *
    t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - p;
}

export async function runPerfForTest(opts: RunOptions): Promise<PerfRunOutput> {
  const { test, outDir, controlURL, experimentURL, perfConfig, browser } = opts;

  const numberOfMeasurements = perfConfig.numberOfMeasurements ?? 5;
  const pThreshold = perfConfig.pValueThreshold ?? 0.05;
  const controlUrl = new URL(test.startingPath, controlURL).href;
  const experimentUrl = new URL(test.startingPath, experimentURL).href;

  fs.mkdirSync(outDir, { recursive: true });

  const controlSamples: NavigationSampleRaw[] = [];
  const experimentSamples: NavigationSampleRaw[] = [];

  try {
    for (let i = 0; i < numberOfMeasurements; i++) {
      controlSamples.push(await sample(browser, controlUrl));
      experimentSamples.push(await sample(browser, experimentUrl));
    }
  } catch (err) {
    return { metrics: [], errored: (err as Error).message };
  }

  const metricKeys: (keyof NavigationSampleRaw)[] = [
    'domContentLoadedMs',
    'loadEventMs',
    'responseEndMs',
    'firstContentfulPaintMs',
  ];
  const metricLabels: Record<keyof NavigationSampleRaw, string> = {
    domContentLoadedMs: 'dom content loaded',
    loadEventMs: 'load event',
    responseEndMs: 'response end',
    firstContentfulPaintMs: 'first contentful paint',
  };

  const metrics: PerfMetricResult[] = [];
  for (const key of metricKeys) {
    const cs = controlSamples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number');
    const es = experimentSamples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number');
    if (cs.length === 0 || es.length === 0) continue;
    const cm = mean(cs);
    const em = mean(es);
    const p = welchPValue(cs, es);
    metrics.push({
      label: metricLabels[key],
      controlMs: cm,
      experimentMs: em,
      controlSamples: cs,
      experimentSamples: es,
      hlDiffMs: em - cm,
      pValue: p,
      significant: p < pThreshold,
    });
  }

  fs.writeFileSync(
    path.join(outDir, 'measurements.json'),
    JSON.stringify({ controlSamples, experimentSamples, metrics }, null, 2),
  );

  return { metrics, errored: null };
}
