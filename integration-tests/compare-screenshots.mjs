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
 * Builds a single HTML report comparing every snapshot PNG between HEAD and
 * the working tree. This is intentionally run-to-run, not branch-to-main:
 * after fresh integration snapshots are written, HEAD is the previous committed
 * baseline and the working tree is the current run. Snapshots hold only the stable-named
 * deep-click report screenshots (directly under each `<suite>-results/` dir),
 * so every PNG diffs meaningfully by path. Each card shows three side-by-side
 * panels — Previous, Current, and Diff — with the previous/current branch,
 * commit, and commit date labeled at the top. Missing images become same-size
 * blank PNGs.
 *
 * Overview/filter/tab shots are near-deterministic — treat any visible
 * change as signal. Artifact-dialog shots host iframes and drift more
 * (iframe/lazy-image timing), so eyeball those for gross breakage only.
 *
 * Usage:
 *   yarn node integration-tests/compare-screenshots.mjs
 *   yarn node integration-tests/compare-screenshots.mjs <dir> [<dir>...]
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
const REPORT_PATH = path.join(SNAPSHOTS_ROOT, 'screenshot-diff-report.html');
const WORK_ROOT = path.join(SNAPSHOTS_ROOT, '.screenshot-diff');

// Screenshots are captured at a >1 device scale factor, so their pixel width
// is larger than the CSS width they were rendered at. Each image is capped at
// `pixel-width × ZOOM` so a panel never upscales a shot past that size (it can
// still shrink to fit a narrow column). Bump ZOOM to inspect detail, lower it
// to fit more per row.
const ZOOM = 0.5;

const argDirs = process.argv.slice(2);
const rawDirs = argDirs.length ? argDirs : DEFAULT_DIRS;
const targetDirs = rawDirs
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

fs.rmSync(WORK_ROOT, { recursive: true, force: true });
fs.mkdirSync(WORK_ROOT, { recursive: true });

function walkPngs(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === WORK_ROOT) continue;
        visit(full);
      } else if (entry.name.endsWith('.png')) {
        out.push(path.normalize(full));
      }
    }
  };
  visit(root);
  return out;
}

function safeGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function gitLine(cmd) {
  return safeGit(cmd)[0] ?? '';
}

const BASE_REF = 'HEAD';
const CURRENT_BRANCH = gitLine('git rev-parse --abbrev-ref HEAD') || 'HEAD';
const refMeta = (ref) => ({
  sha: gitLine(`git rev-parse --short ${ref}`),
  date: gitLine(`git log -1 --format=%cs ${ref}`),
});
const baseMeta = refMeta(BASE_REF);
const headMeta = refMeta('HEAD');
const workingTreeDirty = safeGit('git status --porcelain -- integration-tests/snapshots').length > 0;

const PREV_LABEL = `previous · ${BASE_REF} @ ${baseMeta.sha} · ${baseMeta.date}`;
const CURR_LABEL = `current · ${CURRENT_BRANCH} @ ${headMeta.sha} · ${headMeta.date}`
  + (workingTreeDirty ? ' + uncommitted' : '');

function gitTrackedPngs(root) {
  const tracked = safeGit(`git ls-files -- "${root}"`);
  const committed = safeGit(`git ls-tree --name-only -r ${BASE_REF} -- "${root}"`);
  return new Set(
    [...tracked, ...committed]
      .filter((f) => f.endsWith('.png'))
      .map((f) => path.normalize(f)),
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

function blankPng(width, height) {
  return PNG.sync.write(new PNG({ width, height }));
}

/**
 * Pads an image to `width`×`height` (top-left anchored, transparent fill) so
 * two shots whose page height drifted between runs can still be
 * pixel-compared — the padded region reads as "different" against the other
 * image's real pixels, which is exactly what grew/shrank.
 */
function padTo(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

function writePng(destPath, buffer) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

function relFromReport(p) {
  return path.relative(SNAPSHOTS_ROOT, p).split(path.sep).join('/');
}

function cardFor(relPath) {
  const headBuf = readBaseBuffer(relPath);
  const currentBuf = fs.existsSync(relPath) ? fs.readFileSync(relPath) : null;

  const headImg = headBuf ? decodePng(headBuf) : null;
  const currentImg = currentBuf ? decodePng(currentBuf) : null;

  const width = headImg?.width ?? currentImg?.width ?? 1;
  const height = headImg?.height ?? currentImg?.height ?? 1;

  const oldOut = path.join(WORK_ROOT, 'old', relPath);
  const newOut = path.join(WORK_ROOT, 'new', relPath);
  const diffOut = path.join(WORK_ROOT, 'diff', relPath);

  writePng(oldOut, headBuf ?? blankPng(width, height));
  writePng(newOut, currentBuf ?? blankPng(width, height));

  const sameDims =
    headImg &&
    currentImg &&
    headImg.width === currentImg.width &&
    headImg.height === currentImg.height;

  let numDiffPixels = 0;
  let pct = 0;
  if (headImg && currentImg) {
    // Dimensions can drift between runs (full-page height follows content);
    // pad both to the union size so the pair is still pixel-compared — the
    // grown/shrunk region counts as diff.
    const unionW = Math.max(headImg.width, currentImg.width);
    const unionH = Math.max(headImg.height, currentImg.height);
    const a = padTo(headImg, unionW, unionH);
    const b = padTo(currentImg, unionW, unionH);
    const diff = new PNG({ width: unionW, height: unionH });
    numDiffPixels = pixelmatch(a.data, b.data, diff.data, unionW, unionH, { threshold: 0.1 });
    pct = (numDiffPixels / (unionW * unionH)) * 100;
    writePng(diffOut, PNG.sync.write(diff));
  } else {
    writePng(diffOut, blankPng(width, height));
  }

  return {
    relPath,
    oldOut,
    newOut,
    diffOut,
    hasOld: !!headBuf,
    hasNew: !!currentBuf,
    oldDims: headImg ? `${headImg.width}×${headImg.height}` : null,
    newDims: currentImg ? `${currentImg.width}×${currentImg.height}` : null,
    dimMismatch: !!(headImg && currentImg) && !sameDims,
    // Bytes exist but don't decode as PNG (truncated blob, LFS pointer, …).
    // MUST stay distinct from "identical": we never compared these pixels.
    decodeError: (!!headBuf && !headImg) || (!!currentBuf && !currentImg),
    // Native pixel width of each panel's image, used to cap its display width.
    // The diff is written at the union size of both inputs.
    oldW: headImg?.width ?? currentImg?.width ?? width,
    newW: currentImg?.width ?? headImg?.width ?? width,
    diffW: Math.max(headImg?.width ?? 1, currentImg?.width ?? 1),
    numDiffPixels,
    pct,
  };
}

function sectionCards(dir) {
  const current = new Set(walkPngs(dir));
  const head = gitTrackedPngs(dir);
  const union = new Set([...current, ...head]);
  return [...union].sort().map(cardFor);
}

const sections = targetDirs.map((d) => ({
  label: path.basename(d),
  cards: sectionCards(d),
}));

console.log(`comparing ${PREV_LABEL.replace(/^previous · /, '')}  →  ${CURR_LABEL.replace(/^current · /, '')}\n`);
let totalDecodeErrors = 0;
for (const s of sections) {
  const decodeErrors = s.cards.filter((c) => c.decodeError).length;
  totalDecodeErrors += decodeErrors;
  const changed = s.cards.filter(
    (c) => !c.decodeError && c.hasOld && c.hasNew && (c.dimMismatch || c.numDiffPixels > 0),
  ).length;
  const identical = s.cards.filter(
    (c) => !c.decodeError && c.hasOld && c.hasNew && !c.dimMismatch && c.numDiffPixels === 0,
  ).length;
  const added = s.cards.filter((c) => !c.decodeError && !c.hasOld && c.hasNew).length;
  const deleted = s.cards.filter((c) => !c.decodeError && c.hasOld && !c.hasNew).length;
  const decodeSuffix = decodeErrors > 0 ? `, ${decodeErrors} DECODE ERRORS` : '';
  console.log(
    `${s.label}: ${s.cards.length} total — ${changed} changed, ${identical} identical, ${added} new, ${deleted} deleted${decodeSuffix}`,
  );
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[ch]));
}

function tagFor(card) {
  if (card.decodeError) return 'DECODE ERROR — not compared';
  if (!card.hasOld) return 'new';
  if (!card.hasNew) return 'deleted';
  if (card.dimMismatch) return `dim-shift ${card.oldDims} → ${card.newDims} · ${card.pct.toFixed(2)}% · ${card.numDiffPixels}px`;
  if (card.numDiffPixels === 0) return 'identical';
  return `${card.pct.toFixed(2)}% · ${card.numDiffPixels}px`;
}

// Three side-by-side panels: Previous, Current, Diff. The previous/current
// figcaptions carry the branch · commit · date label so each side is
// identified in place.
function cardHtml(card) {
  return `<article class="card">
    <h3><span class="tag">${esc(tagFor(card))}</span>${esc(card.relPath)}</h3>
    <div class="images">
      <figure><figcaption>${esc(PREV_LABEL)}</figcaption><img loading="lazy" src="${esc(relFromReport(card.oldOut))}" style="max-width:${Math.round(card.oldW * ZOOM)}px"></figure>
      <figure><figcaption>${esc(CURR_LABEL)}</figcaption><img loading="lazy" src="${esc(relFromReport(card.newOut))}" style="max-width:${Math.round(card.newW * ZOOM)}px"></figure>
      <figure><figcaption>Diff</figcaption><img loading="lazy" src="${esc(relFromReport(card.diffOut))}" style="max-width:${Math.round(card.diffW * ZOOM)}px"></figure>
    </div>
  </article>`;
}

function sectionHtml(section) {
  return `<section>
    <h2>${esc(section.label)} <span class="count">${section.cards.length}</span></h2>
    ${section.cards.map(cardHtml).join('\n')}
  </section>`;
}

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Screenshot Diff Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 24px; }
  h1 { font-weight: 500; margin: 0 0 8px; }
  .compare-line { margin: 0 0 24px; color: #aaa; font-size: 13px; }
  h2 { font-weight: 500; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  h2 .count { color: #888; font-size: 14px; margin-left: 8px; }
  .card { background: #16213e; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  .card h3 { font-size: 13px; margin: 0 0 10px; font-weight: 500; display: flex; gap: 12px; align-items: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .tag { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: #333; color: #fff; font-family: system-ui, sans-serif; letter-spacing: 0.5px; white-space: nowrap; }
  .images { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; overflow-wrap: anywhere; }
  img { width: 100%; border: 1px solid #333; border-radius: 4px; background: #0e0e24; display: block; }
</style>
</head><body>
<h1>Screenshot Diff Report</h1>
<p class="compare-line"><span class="tag">${esc(PREV_LABEL)}</span> → <span class="tag">${esc(CURR_LABEL)}</span></p>
${sections.map(sectionHtml).join('\n')}
</body></html>`;

fs.writeFileSync(REPORT_PATH, html);
console.log(`\nReport: ${REPORT_PATH}`);
if (totalDecodeErrors > 0) {
  console.error(
    `\n${totalDecodeErrors} PNG(s) could not be decoded and were NOT compared — inspect the DECODE ERROR cards before trusting this report.`,
  );
  process.exit(1);
}
