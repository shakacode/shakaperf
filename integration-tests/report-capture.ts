import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loud } from './helpers';

interface CaptureOptions {
  page: Page;
  reportHtmlPath: string;
  outDir: string;
  /** Short label used as a filename prefix (e.g. "perf", "visreg"). */
  label: string;
  /** Upper bound on the number of shots taken per clickable-element class. */
  maxPerKind?: number;
}

/**
 * Drives the report-shell HTML report through its interactive states and
 * captures a screenshot of each. The goal is to verify interactive elements
 * render correctly (dialogs, scrubbers, expanded source, filtered grids)
 * rather than just the initial layout.
 */
export async function captureReportScreenshots(opts: CaptureOptions): Promise<void> {
  const { page, reportHtmlPath, outDir, label } = opts;
  const maxPerKind = opts.maxPerKind ?? 8;
  const shotDir = path.join(outDir, 'report-shots');
  fs.mkdirSync(shotDir, { recursive: true });

  const shot = async (name: string) => {
    const file = path.join(shotDir, `${label}__${name}.png`);
    const openDialog = page.locator('dialog[open], .ui-dialog[aria-hidden="false"]').first();
    if ((await openDialog.count()) > 0) {
      await openDialog.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
  };

  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto(`file://${reportHtmlPath}`);
  await page.waitForSelector('.app', { timeout: 15_000 });
  await scrollAndSettle(page);

  // 01 — default view (error/regression/visual_change/improvement visible)
  loud(`Capturing ${label} report: overview`);
  await shot('01-overview');

  // 02 — toggle every status filter on so no_difference tests are visible too
  const filterBtns = page.locator('.filterbar button');
  const nFilter = await filterBtns.count();
  if (nFilter > 0) {
    for (let i = 0; i < nFilter; i++) await filterBtns.nth(i).click().catch(() => {});
    await scrollAndSettle(page);
    await shot('02-all-statuses-toggled');
    // Toggle back to default
    for (let i = 0; i < nFilter; i++) await filterBtns.nth(i).click().catch(() => {});
  }

  // 03 — expand every "test source" toggle
  const sourceToggles = page.locator('.card__code-toggle');
  const nSources = await sourceToggles.count();
  for (let i = 0; i < Math.min(nSources, maxPerKind); i++) {
    await sourceToggles.nth(i).click().catch(() => {});
  }
  if (nSources > 0) {
    await scrollAndSettle(page);
    await shot('03-sources-expanded');
  }

  // 04 — click each artifact link button (bench report, lighthouse, timeline,
  // diff HTMLs). Each opens a dialog hosting an iframe — give it time to paint.
  const artifactBtns = page.locator('.artifact-links__btn');
  const nArtifacts = await artifactBtns.count();
  const artifactShots = Math.min(nArtifacts, maxPerKind);
  for (let i = 0; i < artifactShots; i++) {
    const btn = artifactBtns.nth(i);
    const btnText = ((await btn.textContent()) || `art${i}`).trim();
    const safe = sanitize(btnText);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open], .ui-dialog[aria-hidden="false"]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(1500); // iframe content needs a beat to render
      await shot(`04-artifact-${String(i).padStart(2, '0')}-${safe}`);
      await closeDialog(page);
    }
  }

  // 05 — open the scrubber dialog on one diff card and one no-diff card.
  // All cards within a bucket render the same dialog shell, so one shot per
  // bucket is enough signal.
  const visregBuckets: Array<{ kind: string; selector: string }> = [
    { kind: 'diff', selector: '.visreg-card--diff .visreg-card__images--clickable' },
    { kind: 'nodiff', selector: '.visreg-card--nodiff .visreg-card__images--clickable' },
  ];
  for (const { kind, selector } of visregBuckets) {
    const btn = page.locator(selector).first();
    if ((await btn.count()) === 0) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(800);
      await shot(`05-visreg-${kind}`);
      // Click the scrubber at 20% to move the divider — verifies pointer-driven
      // position update renders correctly without the default 50/50 split.
      const scrubber = page.locator('dialog[open] .scrubber').first();
      if ((await scrubber.count()) > 0) {
        const box = await scrubber.boundingBox();
        if (box) {
          await scrubber.click({
            position: { x: Math.max(1, box.width * 0.2), y: box.height / 2 },
          }).catch(() => {});
          await page.waitForTimeout(200);
          await shot(`05-visreg-${kind}-scrubbed`);
        }
      }
      await closeDialog(page);
    }
  }

  // 06 — timeline preview (shown when a perf metric moved). All previews
  // render the same dialog shell, so one shot is enough signal.
  const firstTimeline = page.locator('.timeline-preview').first();
  if ((await firstTimeline.count()) > 0) {
    await firstTimeline.scrollIntoViewIfNeeded().catch(() => {});
    await firstTimeline.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(1500);
      await shot('06-timeline');
      await closeDialog(page);
    }
  }

  // 07 — error surface: click the "view logs" button on any errored category
  // slot to open the captured engine transcript dialog.
  const errorToggles = page.locator('.slot-error--clickable');
  const nErrors = await errorToggles.count();
  const errorShots = Math.min(nErrors, maxPerKind);
  for (let i = 0; i < errorShots; i++) {
    await errorToggles.nth(i).scrollIntoViewIfNeeded().catch(() => {});
    await errorToggles.nth(i).click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(300);
      await shot(`07-error-${String(i).padStart(2, '0')}`);
      await closeDialog(page);
    }
  }

  // 08 — type a search query to exercise the filter flow
  const search = page.locator('.search input[type="search"]').first();
  if (await search.count() > 0) {
    await search.fill('home');
    await page.waitForTimeout(200);
    await shot('08-search-home');
    await search.fill('');
  }
}

/** Walks `dir` recursively and rewrites every `*.json` file pretty-printed (2-space) so git diffs stay reviewable. */
export function prettifyJsonTree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      prettifyJsonTree(full);
    } else if (entry.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
        fs.writeFileSync(full, JSON.stringify(parsed, null, 2) + '\n');
      } catch {
        // Non-JSON-parsable .json files (unlikely) left alone.
      }
    }
  }
}

/** Walks outDir looking for *.html and saves a full-page screenshot next to each. */
export async function screenshotAllHtml(page: Page, outDir: string): Promise<void> {
  const htmls = findHtmlFiles(outDir);
  loud(`Screenshotting ${htmls.length} HTML artifacts`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const file of htmls) {
    const out = file.replace(/\.html$/, '.screenshot.png');
    try {
      await page.goto(`file://${file}`);
      await scrollAndSettle(page, 500);
      await page.screenshot({ path: out, fullPage: true });
    } catch (err) {
      console.warn(`  failed to screenshot ${file}:`, (err as Error).message);
    }
  }
}

function findHtmlFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) out.push(full);
    }
  };
  walk(root);
  return out;
}

async function closeDialog(page: Page): Promise<void> {
  // Prefer the explicit close button when present; otherwise fall back to Escape.
  const closeBtn = page.locator('dialog[open] .ui-dialog__close, dialog[open] button[aria-label*="close" i]').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(200);
}

/**
 * Scrolls through the whole document in viewport-sized increments so lazy
 * images load, waits for them all to complete, then returns to the top.
 */
async function scrollAndSettle(page: Page, imageTimeout = 10_000): Promise<void> {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewport = page.viewportSize()?.height ?? 800;
  const steps = Math.max(1, Math.ceil(scrollHeight / viewport)) * 2;
  for (let i = 0; i <= steps; i++) {
    const y = (i * viewport) / 2;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await page.evaluate(async (timeout) => {
    const imgs = Array.from(document.querySelectorAll('img'));
    await Promise.race([
      Promise.all(
        imgs.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve());
            img.addEventListener('error', () => resolve());
          });
        }),
      ),
      new Promise((r) => setTimeout(r, timeout)),
    ]);
  }, imageTimeout);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
