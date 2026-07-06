/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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
 * Drives the report-shell HTML report (full-report.html) through its
 * interactive states and captures a screenshot of each. The goal is to verify
 * interactive elements render correctly (dialogs, scrubbers, expanded source,
 * chip-filtered grids) rather than just the initial layout.
 *
 * Selector map (current report-shell + polymorphic stage renderers):
 *   .filterbar (1st)              chip focus filter — dims non-matching cards
 *   details > summary             stage filter menu ("report sections filter")
 *   .card__code-toggle            "test source" / "artifact paths" expanders
 *   .stage-artifact button        preview buttons (lighthouse, timeline
 *                                 filmstrips, profile frames…) → ui-dialog
 *   .artifact-card--compare/.artifact-card--single .artifact-card__media-button
 *                                 visreg diff / no-diff dialogs (+ .scrubber)
 *   .a11y-thumb-button            accessibility findings dialog
 *   .card__logs-button            per-card measurement logs dialog
 *   .search input[type=search]    text filter
 */
export async function captureReportScreenshots(opts: CaptureOptions): Promise<void> {
  const { page, reportHtmlPath, outDir, label } = opts;
  const maxPerKind = opts.maxPerKind ?? 8;
  const shotDir = path.join(outDir, 'report-shots');
  fs.mkdirSync(shotDir, { recursive: true });

  const shot = async (name: string) => {
    const file = path.join(shotDir, `${label}__${name}.png`);
    const openDialog = page.locator('dialog[open]').first();
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

  // 01 — default view. Inline error surfaces (.slot-error with failure
  // media) and every card's chips are visible here without any clicking.
  loud(`Capturing ${label} report: overview`);
  await shot('01-overview');

  // 02 — chip focus filter: click the first non-"all" chip so non-matching
  // cards dim, then reset via the "all" chip.
  const chipBtns = page.locator('.filterbar').first().locator('button');
  if ((await chipBtns.count()) > 1) {
    await chipBtns.nth(1).click().catch(() => {});
    await page.waitForTimeout(200);
    await shot('02-chip-filter');
    await chipBtns.nth(0).click().catch(() => {});
  }

  // 03 — stage filter menu (the "report sections filter" dropdown). It's a
  // native <details>, so it closes by clicking the summary again, not Escape.
  const stageFilterSummary = page.locator('.stage-filter summary, details > summary').first();
  if ((await stageFilterSummary.count()) > 0) {
    await stageFilterSummary.click().catch(() => {});
    await page.waitForTimeout(200);
    await shot('03-stage-filter-menu');
    await stageFilterSummary.click().catch(() => {});
    await page.waitForTimeout(100);
  }

  // 04 — expand every "test source" / "artifact paths" toggle
  const sourceToggles = page.locator('.card__code-toggle');
  const nSources = await sourceToggles.count();
  for (let i = 0; i < Math.min(nSources, maxPerKind); i++) {
    await sourceToggles.nth(i).click().catch(() => {});
  }
  if (nSources > 0) {
    await scrollAndSettle(page);
    await shot('04-sources-expanded');
    for (let i = 0; i < Math.min(nSources, maxPerKind); i++) {
      await sourceToggles.nth(i).click().catch(() => {});
    }
  }

  // 05 — stage artifact preview buttons (lighthouse report, timeline
  // filmstrip, profile frames, perf diff pages…). Each opens a ui-dialog,
  // often hosting an iframe — give it a beat to paint. Visreg media buttons
  // and a11y thumbs get their own dedicated passes below.
  const artifactBtns = page.locator(
    '.stage-artifact button:not(.artifact-card__media-button):not(.a11y-thumb-button)',
  );
  const nArtifacts = await artifactBtns.count();
  const artifactShots = Math.min(nArtifacts, maxPerKind);
  for (let i = 0; i < artifactShots; i++) {
    const btn = artifactBtns.nth(i);
    const btnText = ((await btn.textContent()) || `art${i}`).trim();
    // Strip digits from the label before slugifying: timeline/profile-frame
    // buttons embed per-run timings ("2ms initial page load 326ms …"), and a
    // filename that churns every run breaks the stable-name contract the
    // screenshot diff relies on.
    const safe = sanitize(btnText.replace(/\d+(\.\d+)?/g, ''));
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(1500); // iframe content needs a beat to render
      await shot(`05-artifact-${String(i).padStart(2, '0')}-${safe}`);
      await closeDialog(page);
    }
  }

  // 06 — visreg dialogs: one diff card (control · experiment · diff +
  // scrubber) and one no-diff card. All cards within a bucket render the same
  // dialog shell, so one shot per bucket is enough signal.
  const visregBuckets: Array<{ kind: string; selector: string }> = [
    { kind: 'diff', selector: '.artifact-card--compare .artifact-card__media-button' },
    { kind: 'nodiff', selector: '.artifact-card--single .artifact-card__media-button' },
  ];
  for (const { kind, selector } of visregBuckets) {
    const btn = page.locator(selector).first();
    if ((await btn.count()) === 0) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(800);
      await shot(`06-visreg-${kind}`);
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
          await shot(`06-visreg-${kind}-scrubbed`);
        }
      }
      await closeDialog(page);
    }
  }

  // 07 — accessibility findings dialog (crops + rules for one page)
  const a11yThumb = page.locator('.a11y-thumb-button').first();
  if ((await a11yThumb.count()) > 0) {
    await a11yThumb.scrollIntoViewIfNeeded().catch(() => {});
    await a11yThumb.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(800);
      await shot('07-a11y-dialog');
      await closeDialog(page);
    }
  }

  // 08 — measurement logs dialog (per-stage engine transcript, error lines
  // highlighted — this is where engine failures surface)
  const logsBtn = page.locator('.card__logs-button').first();
  if ((await logsBtn.count()) > 0) {
    await logsBtn.scrollIntoViewIfNeeded().catch(() => {});
    await logsBtn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (dialogOk) {
      await page.waitForTimeout(300);
      await shot('08-logs');
      await closeDialog(page);
    }
  }

  // 09 — type a search query to exercise the text filter flow
  const search = page.locator('.search input[type="search"]').first();
  if (await search.count() > 0) {
    await search.fill('home');
    await page.waitForTimeout(200);
    await shot('09-search-home');
    await search.fill('');
  }
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

/**
 * Drives the v2 client report (`client-report.html`, the client-facing
 * redesign) through its interactive states and captures a screenshot of each:
 *
 *   01-overview               bottom line + three status tiles + tab bar with
 *                             per-tab scores + the active (Performance) panel
 *   02-tab-<perf|a11y|agent>  every tab panel, lazy images settled — perf page
 *                             cards with verdicts/filmstrips/load video,
 *                             accessibility cards with severity chips + crops,
 *                             AI-visibility (agent-ready) category breakdowns
 *   03-tile-jump              clicking a status tile jumps to its tab
 *   04-lightbox               a filmstrip/a11y frame enlarged in the lightbox
 *   05-lightbox-next          the lightbox prev/next strip navigation
 *   06-sev-chip-toggled       severity chip toggled off — problem boxes hidden
 *
 * Every locator is optional: a report without a11y/agent data (or with no
 * frames) simply skips those shots rather than failing the spec.
 */
export async function captureClientReportScreenshots(opts: CaptureOptions): Promise<void> {
  const { page, reportHtmlPath, outDir, label } = opts;
  const shotDir = path.join(outDir, 'report-shots');
  fs.mkdirSync(shotDir, { recursive: true });

  const shot = async (name: string) => {
    const file = path.join(shotDir, `${label}__${name}.png`);
    const lightbox = page.locator('#v2-lb');
    if ((await lightbox.count()) > 0 && (await lightbox.isVisible())) {
      await lightbox.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
  };

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`file://${reportHtmlPath}`);
  await page.waitForSelector('.v2-wrap', { timeout: 15_000 });
  await scrollAndSettle(page);

  // 01 — overview: bottom line, status tiles, tab bar (scores visible), first panel
  loud(`Capturing ${label} client report: overview`);
  await shot('01-overview');

  // 02 — every tab panel except the initially-active one: the overview shot
  // above already shows it, so re-shooting would write a byte-identical
  // duplicate PNG.
  const tabs = page.locator('.v2-tab');
  const nTabs = await tabs.count();
  for (let i = 0; i < nTabs; i++) {
    const tab = tabs.nth(i);
    if ((await tab.getAttribute('aria-selected')) === 'true') continue;
    const id = (await tab.getAttribute('data-tab')) ?? `tab${i}`;
    await tab.click().catch(() => {});
    await scrollAndSettle(page);
    await shot(`02-tab-${sanitize(id)}`);
  }

  // 03 — status tile jump: from the last tab, click the first tile and verify
  // (visually) that the report switched to that tile's panel.
  const firstTile = page.locator('.v2-tile[data-jump]').first();
  if ((await firstTile.count()) > 0) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await firstTile.click().catch(() => {});
    await page.waitForTimeout(200);
    await shot('03-tile-jump');
  }

  // 04/05 — lightbox: enlarge a frame, then use the next arrow to move along
  // the strip. `.v2-shot` covers both filmstrip frames and a11y crops.
  const firstFrame = page.locator('.v2-panel:not([hidden]) .v2-shot').first();
  if ((await firstFrame.count()) > 0) {
    await firstFrame.scrollIntoViewIfNeeded().catch(() => {});
    await firstFrame.click().catch(() => {});
    const lbOpen = await page.locator('#v2-lb').isVisible().catch(() => false);
    if (lbOpen) {
      await page.waitForTimeout(300);
      await shot('04-lightbox');
      const next = page.locator('.v2-lb-next');
      if ((await next.count()) > 0 && (await next.isVisible())) {
        await next.click().catch(() => {});
        await page.waitForTimeout(300);
        await shot('05-lightbox-next');
      }
      await page.locator('.v2-lb-close').click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  // 06 — accessibility severity chip toggle hides that severity's boxes
  const a11yTab = page.locator('.v2-tab[data-tab="a11y"]');
  const sevChip = page.locator('.v2-sev-chip').first();
  if ((await a11yTab.count()) > 0 && (await sevChip.count()) > 0) {
    await a11yTab.click().catch(() => {});
    await page.waitForTimeout(200);
    await sevChip.scrollIntoViewIfNeeded().catch(() => {});
    await sevChip.click().catch(() => {});
    await page.waitForTimeout(200);
    await shot('06-sev-chip-toggled');
    await sevChip.click().catch(() => {});
  }
}
