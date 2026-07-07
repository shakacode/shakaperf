#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * The AI-readable companion to compare-screenshots.mjs. That script writes an
 * HTML scrubber report for a human to eyeball; this one bakes the same
 * HEAD-vs-working-tree comparison into flat PNG triptychs an agent can open
 * with the Read tool.
 *
 * For every CHANGED (or new / deleted / decode-error) snapshot it composes one
 * self-contained image with three panels, left to right:
 *
 *     [ PREVIOUS ]  [ DIFF ]  [ CURRENT ]
 *       (HEAD)      (red =    (working
 *                   changed    tree)
 *                   pixels)
 *
 * Each panel carries a colour header band as a quick anchor — blue = previous,
 * red = diff, green = current — and the middle panel is the pixelmatch diff
 * rendered as red highlights over a faded ghost of the previous shot, so an
 * agent can see BOTH where pixels changed and what the surrounding page looked
 * like. Identical shots are skipped by default (nothing to look at); pass
 * `--all` to emit them too. Panels are downscaled to keep each triptych small
 * enough to read comfortably while staying legible.
 *
 * Output goes under the git-ignored `.screenshot-diff/triptychs/` scratch dir,
 * mirroring each shot's `<suite>/<name>.png` path. Every generated file is
 * listed on stdout, tagged `deterministic` (overview/filter/tab/lightbox/logs —
 * any visible change is signal) or `artifact-dialog` (iframe-hosting shots that
 * drift between runs — gross breakage only), so the caller knows which bar to
 * apply to each.
 *
 * Usage:
 *   yarn node integration-tests/compose-diff-triptychs.mjs
 *   yarn node integration-tests/compose-diff-triptychs.mjs [--all] [<dir>...]
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_DIRS = [
  'integration-tests/snapshots/bench-results',
  'integration-tests/snapshots/visreg-results',
  'integration-tests/snapshots/audit-results',
];
const SNAPSHOTS_ROOT = 'integration-tests/snapshots';
// Live under the same git-ignored scratch dir compare-screenshots.mjs uses.
const OUT_ROOT = path.join(SNAPSHOTS_ROOT, '.screenshot-diff', 'triptychs');
const BASE_REF = 'HEAD';

// Composition constants. Panels are downscaled to at most these dimensions so a
// full-page shot stays legible without producing a huge triptych.
const MAX_PANEL_W = 460;
const MAX_PANEL_H = 1600;
const GUTTER = 6;
const HEADER_H = 14;
const MARGIN = 6;
const BG = [14, 14, 36]; // matches the HTML report's #0e0e24 canvas
const HEADER_COLORS = [
  [70, 130, 220], // previous — blue
  [229, 72, 77], // diff — red
  [60, 190, 120], // current — green
];

const args = process.argv.slice(2);
const includeIdentical = args.includes('--all');
const rawDirs = args.filter((a) => !a.startsWith('--'));
const targetDirs = (rawDirs.length ? rawDirs : DEFAULT_DIRS)
  .map((d) => d.replace(/\/+$/, ''))
  .filter((d) => {
    if (!fs.existsSync(d)) {
      console.warn(`skipping missing dir: ${d}`);
      return false;
    }
    return true;
  });

if (targetDirs.length === 0) {
  console.error('No results dirs to compare.');
  process.exit(1);
}

fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT_ROOT, { recursive: true });

function safeGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function walkPngs(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.png')) out.push(path.normalize(full));
    }
  };
  visit(root);
  return out;
}

function gitTrackedPngs(root) {
  const tracked = safeGit(`git ls-files -- "${root}"`);
  const committed = safeGit(`git ls-tree --name-only -r ${BASE_REF} -- "${root}"`);
  return new Set(
    [...tracked, ...committed].filter((f) => f.endsWith('.png')).map((f) => path.normalize(f)),
  );
}

function readBaseBuffer(relPath) {
  try {
    return execSync(`git show "${BASE_REF}:${relPath}"`, {
      encoding: 'buffer',
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

function decodePng(buf) {
  try {
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

/** Top-left-anchored pad to width×height, transparent fill (grown region reads as diff). */
function padTo(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

/** Alpha-composite over an opaque bg and force alpha 255 (drops padded/transparent regions to bg). */
function flatten(img, [br, bg, bb]) {
  const out = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out.data[i] = Math.round(img.data[i] * a + br * (1 - a));
    out.data[i + 1] = Math.round(img.data[i + 1] * a + bg * (1 - a));
    out.data[i + 2] = Math.round(img.data[i + 2] * a + bb * (1 - a));
    out.data[i + 3] = 255;
  }
  return out;
}

/** Nearest-neighbour downscale (never upscales) so full-page shots stay small but legible. */
function downscale(img, maxW, maxH) {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function fillRect(png, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h && y < png.height; y++) {
    if (y < 0) continue;
    for (let x = x0; x < x0 + w && x < png.width; x++) {
      if (x < 0) continue;
      const i = (y * png.width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
}

/** Build one opaque, downscaled panel from a full-resolution (possibly-null) image. */
function panelFrom(img, unionW, unionH) {
  const base = img ? padTo(img, unionW, unionH) : new PNG({ width: unionW, height: unionH });
  return downscale(flatten(base, BG), MAX_PANEL_W, MAX_PANEL_H);
}

/** A shot is drift-prone iff it hosts an iframe artifact dialog (lighthouse/timeline/diff). */
function classify(relPath) {
  return /artifact/i.test(path.basename(relPath)) ? 'artifact-dialog' : 'deterministic';
}

function compose(prevPanel, diffPanel, curPanel) {
  // Panels share union dims, so the same downscale yields identical sizes.
  const pw = prevPanel.width;
  const ph = prevPanel.height;
  const canvasW = MARGIN * 2 + pw * 3 + GUTTER * 2;
  const canvasH = MARGIN * 2 + HEADER_H + ph;
  const canvas = new PNG({ width: canvasW, height: canvasH });
  fillRect(canvas, 0, 0, canvasW, canvasH, BG);
  const panels = [prevPanel, diffPanel, curPanel];
  for (let p = 0; p < 3; p++) {
    const x = MARGIN + p * (pw + GUTTER);
    fillRect(canvas, x, MARGIN, pw, HEADER_H, HEADER_COLORS[p]);
    PNG.bitblt(panels[p], canvas, 0, 0, panels[p].width, ph, x, MARGIN + HEADER_H);
  }
  return canvas;
}

function tripFor(relPath) {
  const headBuf = readBaseBuffer(relPath);
  const currentBuf = fs.existsSync(relPath) ? fs.readFileSync(relPath) : null;
  const headImg = headBuf ? decodePng(headBuf) : null;
  const currentImg = currentBuf ? decodePng(currentBuf) : null;

  const decodeError = (!!headBuf && !headImg) || (!!currentBuf && !currentImg);
  const hasOld = !!headBuf;
  const hasNew = !!currentBuf;

  const unionW = Math.max(headImg?.width ?? 1, currentImg?.width ?? 1);
  const unionH = Math.max(headImg?.height ?? 1, currentImg?.height ?? 1);

  let numDiffPixels = 0;
  let pct = 0;
  let diffFull = null;
  if (headImg && currentImg) {
    const a = padTo(headImg, unionW, unionH);
    const b = padTo(currentImg, unionW, unionH);
    diffFull = new PNG({ width: unionW, height: unionH });
    // No diffMask: draw a faded ghost of the previous shot with changed pixels
    // in red, so the diff panel is legible on its own.
    numDiffPixels = pixelmatch(a.data, b.data, diffFull.data, unionW, unionH, {
      threshold: 0.1,
      alpha: 0.4,
      diffColor: [255, 0, 0],
    });
    pct = (numDiffPixels / (unionW * unionH)) * 100;
  }

  const dimMismatch =
    !!(headImg && currentImg) &&
    (headImg.width !== currentImg.width || headImg.height !== currentImg.height);

  let status;
  if (decodeError) status = 'decode-error';
  else if (!hasOld) status = 'new';
  else if (!hasNew) status = 'deleted';
  else if (dimMismatch || numDiffPixels > 0) status = 'changed';
  else status = 'identical';

  return {
    relPath,
    status,
    pct,
    numDiffPixels,
    dimMismatch,
    oldDims: headImg ? `${headImg.width}x${headImg.height}` : null,
    newDims: currentImg ? `${currentImg.width}x${currentImg.height}` : null,
    kind: classify(relPath),
    headImg,
    currentImg,
    diffFull,
    unionW,
    unionH,
  };
}

function tagFor(t) {
  if (t.status === 'decode-error') return 'DECODE ERROR — not compared';
  if (t.status === 'new') return 'new — no previous';
  if (t.status === 'deleted') return 'deleted — no current';
  if (t.dimMismatch) return `dim-shift ${t.oldDims} -> ${t.newDims} · ${t.pct.toFixed(2)}% · ${t.numDiffPixels}px`;
  return `${t.pct.toFixed(2)}% · ${t.numDiffPixels}px`;
}

let written = 0;
const perSuite = [];
for (const dir of targetDirs) {
  const current = new Set(walkPngs(dir));
  const head = gitTrackedPngs(dir);
  const union = [...new Set([...current, ...head])].sort();
  const trips = union.map(tripFor);

  const counts = { changed: 0, identical: 0, new: 0, deleted: 0, decodeErrors: 0 };
  for (const t of trips) {
    if (t.status === 'decode-error') counts.decodeErrors++;
    else if (t.status === 'changed') counts.changed++;
    else if (t.status === 'identical') counts.identical++;
    else if (t.status === 'new') counts.new++;
    else if (t.status === 'deleted') counts.deleted++;
  }
  perSuite.push({ label: path.basename(dir), total: trips.length, counts });

  const emit = trips.filter((t) => t.status !== 'identical' || includeIdentical);
  const listed = [];
  for (const t of emit) {
    const prevPanel = panelFrom(t.headImg, t.unionW, t.unionH);
    const curPanel = panelFrom(t.currentImg, t.unionW, t.unionH);
    // For new/deleted/decode-error there is no diff image — show a blank
    // bg panel so the triptych keeps its three-column shape.
    const diffPanel = t.diffFull
      ? downscale(flatten(t.diffFull, BG), MAX_PANEL_W, MAX_PANEL_H)
      : panelFrom(null, t.unionW, t.unionH);
    const canvas = compose(prevPanel, diffPanel, curPanel);
    const outPath = path.join(OUT_ROOT, t.relPath.replace(/^integration-tests\/snapshots\//, ''));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, PNG.sync.write(canvas));
    written++;
    listed.push({ outPath, t });
  }
  perSuite[perSuite.length - 1].listed = listed;
}

console.log('Triptychs: [ PREVIOUS (HEAD, blue) | DIFF (red = changed pixels) | CURRENT (working tree, green) ]\n');

let decodeTotal = 0;
for (const s of perSuite) {
  decodeTotal += s.counts.decodeErrors;
  const de = s.counts.decodeErrors > 0 ? `, ${s.counts.decodeErrors} DECODE ERRORS` : '';
  console.log(
    `${s.label}: ${s.total} total — ${s.counts.changed} changed, ${s.counts.identical} identical, ${s.counts.new} new, ${s.counts.deleted} deleted${de}`,
  );
  for (const { outPath, t } of s.listed) {
    console.log(`  [${t.kind}] ${outPath}  (${tagFor(t)})`);
  }
}

console.log(`\n${written} triptych(s) written under ${OUT_ROOT}`);
console.log('Read each one and check the content bar: no blank/black panels where a page render is');
console.log('expected, no empty card grids, no missing tiles/tabs/scores, no unstyled fallback text.');
console.log('deterministic shots — any visible change is signal; artifact-dialog shots — gross breakage only.');

if (decodeTotal > 0) {
  console.error(`\n${decodeTotal} PNG(s) could not be decoded and were NOT diffed — inspect their DECODE ERROR triptychs.`);
  process.exit(1);
}
