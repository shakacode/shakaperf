import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser } from 'playwright-core';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { AbTestDefinition } from 'shaka-shared';
import type { VisregConfig } from '../config';

interface ViewportSpec {
  label: string;
  width: number;
  height: number;
}

export interface VisregCaptureResult {
  viewportLabel: string;
  selector: string;
  controlPath: string;
  experimentPath: string;
  diffPath: string | null;
  controlBytes: number;
  experimentBytes: number;
  diffPixels: number;
  totalPixels: number;
  misMatchPercentage: number;
  threshold: number;
  changed: boolean;
}

export interface VisregRunOutput {
  results: VisregCaptureResult[];
  errored: string | null;
}

interface RunOptions {
  test: AbTestDefinition;
  outDir: string;
  controlURL: string;
  experimentURL: string;
  visregConfig: VisregConfig;
  browser: Browser;
}

async function captureOne(
  browser: Browser,
  url: string,
  viewport: ViewportSpec,
  selector: string,
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    if (selector === 'document') {
      return await page.screenshot({ fullPage: false, type: 'png' });
    }
    const handle = await page.waitForSelector(selector, { timeout: 5_000 });
    return await handle.screenshot({ type: 'png' });
  } finally {
    await context.close();
  }
}

function diffImages(controlPng: Buffer, experimentPng: Buffer): { diffBuf: Buffer; diffPixels: number; totalPixels: number } | null {
  const a = PNG.sync.read(controlPng);
  const b = PNG.sync.read(experimentPng);
  if (a.width !== b.width || a.height !== b.height) {
    return null;
  }
  const out = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  const total = a.width * a.height;
  return { diffBuf: PNG.sync.write(out), diffPixels, totalPixels: total };
}

function viewportsFor(test: AbTestDefinition, defaults: ViewportSpec[]): ViewportSpec[] {
  const override = test.options.visreg?.viewports;
  return override && override.length > 0 ? override.map((v) => ({ label: v.label, width: v.width, height: v.height })) : defaults;
}

function selectorsFor(test: AbTestDefinition): string[] {
  const sel = test.options.visreg?.selectors;
  return sel && sel.length > 0 ? sel : ['document'];
}

function safeFileSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'x';
}

export async function runVisregForTest(opts: RunOptions): Promise<VisregRunOutput> {
  const { test, outDir, controlURL, experimentURL, visregConfig, browser } = opts;

  const defaultViewports: ViewportSpec[] = (visregConfig.viewports ?? [
    { label: 'desktop', width: 1280, height: 800 },
  ]).map((v) => ({ label: v.label, width: v.width, height: v.height }));
  const threshold = test.options.visreg?.misMatchThreshold ?? visregConfig.defaultMisMatchThreshold ?? 0.1;

  fs.mkdirSync(path.join(outDir, 'control'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'experiment'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'diff'), { recursive: true });

  const controlUrl = new URL(test.startingPath, controlURL).href;
  const experimentUrl = new URL(test.startingPath, experimentURL).href;
  const viewports = viewportsFor(test, defaultViewports);
  const selectors = selectorsFor(test);

  const results: VisregCaptureResult[] = [];

  for (const viewport of viewports) {
    for (const selector of selectors) {
      const segment = `${safeFileSegment(viewport.label)}__${safeFileSegment(selector)}`;
      const controlPath = path.join(outDir, 'control', `${segment}.png`);
      const experimentPath = path.join(outDir, 'experiment', `${segment}.png`);
      const diffPath = path.join(outDir, 'diff', `${segment}.png`);

      try {
        const [controlBuf, experimentBuf] = await Promise.all([
          captureOne(browser, controlUrl, viewport, selector),
          captureOne(browser, experimentUrl, viewport, selector),
        ]);
        fs.writeFileSync(controlPath, controlBuf);
        fs.writeFileSync(experimentPath, experimentBuf);

        const diff = diffImages(controlBuf, experimentBuf);
        let diffPixels = 0;
        let totalPixels = 0;
        let misMatchPercentage = 0;
        let savedDiffPath: string | null = null;
        if (diff) {
          fs.writeFileSync(diffPath, diff.diffBuf);
          diffPixels = diff.diffPixels;
          totalPixels = diff.totalPixels;
          misMatchPercentage = (diffPixels / totalPixels) * 100;
          savedDiffPath = diffPath;
        }

        results.push({
          viewportLabel: viewport.label,
          selector,
          controlPath,
          experimentPath,
          diffPath: savedDiffPath,
          controlBytes: controlBuf.length,
          experimentBytes: experimentBuf.length,
          diffPixels,
          totalPixels,
          misMatchPercentage,
          threshold,
          changed: misMatchPercentage > threshold,
        });
      } catch (err) {
        return {
          results,
          errored: `${viewport.label}/${selector}: ${(err as Error).message}`,
        };
      }
    }
  }

  return { results, errored: null };
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}
