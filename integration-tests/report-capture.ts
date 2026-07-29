/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { expect, type Page, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loud } from './helpers';

interface CaptureOptions {
  page: Page;
  reportHtmlPath: string;
  outDir: string;
  /** Short label used as a filename prefix (e.g. "perf", "visreg"). */
  label: string;
  /**
   * Upper bound on how many source toggles are expanded into the one
   * `04-sources-expanded` shot. (Artifact dialogs are no longer capped — they
   * are deduped to one shot per kind: a single Lighthouse and a single
   * timeline dialog, keyed by dialog title.)
   */
  maxPerKind?: number;
}

/**
 * Drives the report-shell HTML report (full-report.html) through its
 * interactive states. Render-only states (dialogs, scrubbers, expanded source)
 * are screenshotted; the FILTERS (chip focus, stage filter, text search) are
 * instead asserted in the DOM — we check the filter took effect rather than
 * snapshotting the filtered grid, since a pixel diff of a filtered layout is
 * noisy and proves less than a direct expectation.
 *
 * Selector map (current report-shell + polymorphic stage renderers):
 *   .filterbar (1st)              chip focus filter — dims non-matching cards (asserted)
 *   .stage-filter                 stage filter menu ("report sections filter") (asserted)
 *   .card__code-toggle            "test source" / "artifact paths" expanders
 *   .stage-artifact button        preview buttons (lighthouse, timeline
 *                                 filmstrips, profile frames…) → ui-dialog
 *   .artifact-card--compare/.artifact-card--single .artifact-card__media-button
 *                                 visreg diff / no-diff dialogs (+ .scrubber). The
 *                                 diff shot targets the Homepage [data-cy="hero-section"]
 *                                 card specifically (the sabotaged, always-diffing one).
 *   .a11y-thumb-button            accessibility findings dialog
 *   .card__logs-button            per-card measurement logs dialog
 *   .search input[type=search]    text filter (asserted)
 *
 * Returns the shot names taken (e.g. "01-overview") so the caller can assert
 * its suite's mandatory shots were actually captured — every interaction here
 * is optional-locator + swallowed-click by design, so without that assertion
 * a renamed selector would silently drop a whole evidence class.
 */
export async function captureReportScreenshots(opts: CaptureOptions): Promise<string[]> {
  const { page, reportHtmlPath, outDir, label } = opts;
  const maxPerKind = opts.maxPerKind ?? 8;
  const shotDir = outDir;
  fs.mkdirSync(shotDir, { recursive: true });

  const taken: string[] = [];
  const shot = async (name: string) => {
    const file = path.join(shotDir, `${label}__${name}.png`);
    const openDialog = page.locator('dialog[open]').first();
    if ((await openDialog.count()) > 0) {
      await openDialog.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    taken.push(name);
  };

  // 1366×768 — the classic laptop screen, the report's most common real
  // viewing size; fullPage shots extend the height as needed.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`file://${reportHtmlPath}`);
  await page.waitForSelector('.app', { timeout: 15_000 });
  await scrollAndSettle(page);

  // 01 — default view. Inline error surfaces (.slot-error with failure
  // media) and every card's chips are visible here without any clicking.
  loud(`Capturing ${label} report: overview`);
  await shot('01-overview');

  // 02 — chip focus filter. Asserted, not screenshotted: clicking a non-"all"
  // chip isolates it (data-active) and dims the cards that lack that tag
  // (data-dimmed); the "all" chip clears the focus. The dim is best-effort —
  // a report with a single card, or where every card carries the tag, dims
  // nothing yet the filter is still correct — so we require the two invariants
  // that always hold: the chip goes active, and "all" leaves zero cards dimmed.
  const chipBtns = page.locator('.filterbar').first().locator('button');
  const nChips = await chipBtns.count();
  if (nChips > 1) {
    const dimmed = page.locator('.card[data-dimmed="true"]');
    await expect(dimmed, 'nothing should be dimmed before a chip is selected').toHaveCount(0);
    const chip = chipBtns.nth(1);
    await chip.click();
    await expect(chip, 'clicking a chip must isolate it (data-active=true)').toHaveAttribute('data-active', 'true');
    // Reset to the unfiltered grid so later shots start from a known state.
    await chipBtns.nth(0).click();
    await expect(dimmed, 'the "all" chip must leave no card dimmed').toHaveCount(0);
  }

  // 03 — stage filter (the "report sections filter" dropdown). Asserted, not
  // screenshotted: it toggles which pipeline stages render inside each card, so
  // clearing every stage empties the per-stage sections (.outcome-slot) and
  // re-enabling them restores the exact set. It's a native <details>, so the
  // menu opens/closes by clicking its summary.
  const stageFilter = page.locator('.stage-filter');
  if ((await stageFilter.count()) > 0) {
    const summary = stageFilter.locator('summary').first();
    const slots = page.locator('.outcome-slot');
    const before = await slots.count();
    expect(before, 'report must render at least one stage section to filter').toBeGreaterThan(0);
    await summary.click();
    await stageFilter.getByRole('button', { name: 'none', exact: true }).click();
    await expect(slots, 'hiding every stage must empty the per-stage sections').toHaveCount(0);
    await stageFilter.getByRole('button', { name: 'all', exact: true }).click();
    await expect(slots, 're-enabling every stage must restore the sections').toHaveCount(before);
    await summary.click(); // close the <details> menu
  }

  // 04 — expand every "test source" / "artifact paths" toggle
  const sourceToggles = page.locator('.card__code-toggle');
  const nSources = await sourceToggles.count();
  for (let i = 0; i < Math.min(nSources, maxPerKind); i++) {
    await sourceToggles.nth(i).click().catch(() => {});
  }
  if (nSources > 0) {
    // The toggles reveal <pre class="card__code"> blocks; wait for at least one
    // to be present before settling so the shot includes the expanded source.
    await page.locator('.card__code').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await scrollAndSettle(page);
    await shot('04-sources-expanded');
    for (let i = 0; i < Math.min(nSources, maxPerKind); i++) {
      await sourceToggles.nth(i).click().catch(() => {});
    }
  }

  // 05 — stage artifact dialogs, deduped to ONE representative per kind. The
  // reports expose an artifact preview button per page/viewport (control lh,
  // experiment lh, timeline, profile frames, perf diff pages…), which
  // previously produced a stack of near-identical `05-artifact-0N` shots. We
  // only need to prove each dialog KIND still renders, so capture a single
  // Lighthouse dialog and a single timeline dialog, keyed by the dialog's own
  // title (stable across runs — the per-run timings live in the dialog body).
  // Walk the buttons in DOM order, opening each just long enough to read its
  // title, and shoot the first match for each kind; stop once both are caught.
  const artifactKinds: Array<{ kind: string; title: RegExp }> = [
    { kind: 'lighthouse', title: /lighthouse|(^|\W)lh\b/i },
    { kind: 'timeline', title: /timeline/i },
  ];
  const capturedKinds = new Set<string>();
  const artifactBtns = page.locator(
    '.stage-artifact button:not(.artifact-card__media-button):not(.a11y-thumb-button)',
  );
  const nArtifacts = await artifactBtns.count();
  for (let i = 0; i < nArtifacts && capturedKinds.size < artifactKinds.length; i++) {
    const btn = artifactBtns.nth(i);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    const dialogOk = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
    if (!dialogOk) continue;
    const title = ((await page.locator('dialog[open] .ui-dialog__title-text').first()
      .textContent().catch(() => '')) ?? '').trim();
    const match = artifactKinds.find((k) => !capturedKinds.has(k.kind) && k.title.test(title));
    if (match) {
      await page.waitForTimeout(1500); // iframe content needs a beat to render
      await shot(`05-artifact-${match.kind}`);
      capturedKinds.add(match.kind);
    }
    await closeDialog(page);
  }

  // 06 — visreg dialogs: one diff card (control · experiment · diff +
  // scrubber) and one no-diff card. All cards within a bucket render the same
  // dialog shell, so one shot per bucket is enough signal.
  const visregBuckets: Array<{ kind: string; button: Locator }> = [
    {
      kind: 'diff',
      button: page
        .locator('.card')
        .filter({ has: page.locator('.card__title', { hasText: 'Homepage' }) })
        .locator('.artifact-card--compare')
        .filter({ has: page.locator('.artifact-card__subtitle', { hasText: '[data-cy="hero-section"]' }) })
        .locator('.artifact-card__media-button'),
    },
    { kind: 'nodiff', button: page.locator('.artifact-card--single .artifact-card__media-button') },
  ];
  for (const { kind, button } of visregBuckets) {
    const btn = button.first();
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

  // 09 — text filter. Asserted, not screenshotted: matchesQuery drops the cards
  // that don't match the query outright (it doesn't dim them), so a query that
  // matches nothing empties the grid and clearing it restores every card. Using
  // an impossible query keeps this deterministic no matter how many cards the
  // report holds (a real term would narrow to a data-dependent subset).
  const search = page.locator('.search input[type="search"]').first();
  if ((await search.count()) > 0) {
    const cards = page.locator('.card');
    const before = await cards.count();
    expect(before, 'report must render cards for the text filter to act on').toBeGreaterThan(0);
    await search.fill('zzz-no-such-test-zzz');
    await expect(cards, 'a non-matching query must hide every card').toHaveCount(0);
    await search.fill('');
    await expect(cards, 'clearing the text filter must restore every card').toHaveCount(before);
  }

  return taken;
}

async function closeDialog(page: Page): Promise<void> {
  // Prefer the explicit close button when present; otherwise fall back to Escape.
  const closeBtn = page.locator('dialog[open] .ui-dialog__close, dialog[open] button[aria-label*="close" i]').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  // A dialog that won't close is a report bug, and swallowing it would poison
  // every later screenshot (shot() prefers `dialog[open]`, so the stale dialog
  // would be captured under each subsequent shot's name). Fail loudly instead.
  try {
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 2000 });
  } catch {
    throw new Error('closeDialog: a dialog[open] refused to close — the close button/Escape handling in the report is broken');
  }
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
 *   02-tab-<a11y|agent>       every tab panel EXCEPT the initially-active one
 *                             (the overview already shows it, so re-shooting
 *                             would write a byte-identical duplicate) —
 *                             accessibility cards with severity chips + crops,
 *                             AI-visibility (agent-ready) category breakdowns
 *   04-lightbox               a filmstrip/a11y frame enlarged in the lightbox
 *   05-lightbox-next          the lightbox prev/next strip navigation
 *
 * Two interactions are NOT screenshotted — they're asserted in the DOM instead,
 * same rationale as the full-report filters: the status-tile jump (clicking a
 * tile reveals its target panel + selects its tab — the old shot was pixel-
 * identical to the overview) and the accessibility severity-chip filter
 * (toggling a chip flips its aria-pressed and hides/shows that severity's boxes).
 *
 * Every locator is optional: a report without a11y/agent data (or with no
 * frames) simply skips those shots rather than failing the spec. Returns the
 * shot names taken so the caller can assert its mandatory shots landed.
 */
export async function captureClientReportScreenshots(opts: CaptureOptions): Promise<string[]> {
  const { page, reportHtmlPath, outDir, label } = opts;
  const shotDir = outDir;
  fs.mkdirSync(shotDir, { recursive: true });

  const taken: string[] = [];
  const shot = async (name: string) => {
    const file = path.join(shotDir, `${label}__${name}.png`);
    const lightbox = page.locator('#cr-lb');
    if ((await lightbox.count()) > 0 && (await lightbox.isVisible())) {
      await lightbox.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    taken.push(name);
  };

  // Same 1366×768 laptop viewport as the technical-report capture, so every
  // snapshot renders at the report's most common real viewing size.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`file://${reportHtmlPath}`);
  await page.waitForSelector('.cr-wrap', { timeout: 15_000 });
  await scrollAndSettle(page);

  // 01 — overview: bottom line, status tiles, tab bar (scores visible), first panel
  loud(`Capturing ${label} client report: overview`);
  await shot('01-overview');

  // 02 — every tab panel except the initially-active one: the overview shot
  // above already shows it, so re-shooting would write a byte-identical
  // duplicate PNG.
  const tabs = page.locator('.cr-tab');
  const nTabs = await tabs.count();
  for (let i = 0; i < nTabs; i++) {
    const tab = tabs.nth(i);
    if ((await tab.getAttribute('aria-selected')) === 'true') continue;
    const id = (await tab.getAttribute('data-tab')) ?? `tab${i}`;
    await tab.click().catch(() => {});
    await scrollAndSettle(page);
    await shot(`02-tab-${sanitize(id)}`);
  }

  // 03 — status tile jump. Asserted, not screenshotted: the status tiles are
  // jump-links (data-jump="<tab>") that switch to that tab's panel. The 02 loop
  // above left us on the last tab, so clicking the first tile navigates to its
  // target — assert that panel is revealed and its tab becomes selected. (The
  // old 03-tile-jump.png was dropped as a near-duplicate of a panel shot 01/02
  // already covers.) The tiles are ordered worst-problem-first, so which panel
  // this lands on is data-dependent — and it is the panel 04/05 below shoot.
  const firstTile = page.locator('.cr-tile[data-jump]').first();
  if ((await firstTile.count()) > 0) {
    const target = await firstTile.getAttribute('data-jump');
    await page.evaluate(() => window.scrollTo(0, 0));
    await firstTile.click();
    await expect(page.locator(`#cr-panel-${target}`), 'clicking a status tile must reveal its target panel').toBeVisible();
    await expect(page.locator(`.cr-tab[data-tab="${target}"]`), 'the tile jump must select the target tab').toHaveAttribute('aria-selected', 'true');
  }

  // 04/05 — lightbox: enlarge a frame, then use the next arrow to move along
  // the strip. `.cr-shot` covers both filmstrip frames and a11y crops.
  const firstFrame = page.locator('.cr-panel:not([hidden]) .cr-shot').first();
  if ((await firstFrame.count()) > 0) {
    await firstFrame.scrollIntoViewIfNeeded().catch(() => {});
    await firstFrame.click().catch(() => {});
    const lbOpen = await page.locator('#cr-lb').isVisible().catch(() => false);
    if (lbOpen) {
      await page.waitForTimeout(300);
      await shot('04-lightbox');
      const next = page.locator('.cr-lb-next');
      if ((await next.count()) > 0 && (await next.isVisible())) {
        await next.click().catch(() => {});
        await page.waitForTimeout(300);
        await shot('05-lightbox-next');
      }
      await page.locator('.cr-lb-close').click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  // 06 — accessibility severity chip toggle. Asserted, not screenshotted:
  // toggling a severity chip off flips its aria-pressed to "false", marks it
  // cr-sev-off, and hides that severity's problem boxes (.cr-box-<sev>) on the
  // frames; toggling back restores them. When the chip's severity has boxes on
  // screen we assert they hide/show; the aria-pressed round-trip is checked
  // regardless.
  const a11yTab = page.locator('.cr-tab[data-tab="a11y"]');
  const sevChip = page.locator('.cr-sev-chip').first();
  if ((await a11yTab.count()) > 0 && (await sevChip.count()) > 0) {
    await a11yTab.click();
    await sevChip.scrollIntoViewIfNeeded().catch(() => {});
    const sev = await sevChip.getAttribute('data-sev');
    const boxes = page.locator(`.cr-a11y-card .cr-box-${sev}`);
    const hadBoxes = (await boxes.count()) > 0;

    await sevChip.click();
    await expect(sevChip, 'toggling a severity chip off must set aria-pressed=false').toHaveAttribute('aria-pressed', 'false');
    if (hadBoxes) {
      await expect(boxes.first(), 'toggling the chip off must hide its problem boxes').toBeHidden();
    }

    await sevChip.click();
    await expect(sevChip, 'toggling the chip back on must restore aria-pressed=true').toHaveAttribute('aria-pressed', 'true');
    if (hadBoxes) {
      await expect(boxes.first(), 'toggling the chip back on must re-show its boxes').toBeVisible();
    }
  }

  return taken;
}
