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
 * the working tree. Snapshots hold only the stable-named deep-click report
 * screenshots (directly under each `<suite>-results/` dir), so every PNG
 * diffs meaningfully by path. Every card
 * always shows three images side by side: Previous, Current, Diff. Missing
 * images become same-size blank PNGs.
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

function gitTrackedPngs(root) {
  const tracked = safeGit(`git ls-files -- "${root}"`);
  const committed = safeGit(`git ls-tree --name-only -r HEAD -- "${root}"`);
  return new Set(
    [...tracked, ...committed]
      .filter((f) => f.endsWith('.png'))
      .map((f) => path.normalize(f)),
  );
}

function readHeadBuffer(relPath) {
  try {
    return execSync(`git show "HEAD:${relPath}"`, {
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

function writePng(destPath, buffer) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

function relFromReport(p) {
  return path.relative(SNAPSHOTS_ROOT, p).split(path.sep).join('/');
}

function cardFor(relPath) {
  const headBuf = readHeadBuffer(relPath);
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
  if (sameDims) {
    const diff = new PNG({ width: headImg.width, height: headImg.height });
    numDiffPixels = pixelmatch(
      headImg.data,
      currentImg.data,
      diff.data,
      headImg.width,
      headImg.height,
      { threshold: 0.1 },
    );
    pct = (numDiffPixels / (headImg.width * headImg.height)) * 100;
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
  if (card.dimMismatch) return `dim-shift ${card.oldDims} → ${card.newDims}`;
  if (card.numDiffPixels === 0) return 'identical';
  return `${card.pct.toFixed(2)}% · ${card.numDiffPixels}px`;
}

function cardHtml(card) {
  return `<article class="card">
    <h3><span class="tag">${esc(tagFor(card))}</span>${esc(card.relPath)}</h3>
    <div class="images">
      <figure><figcaption>Previous</figcaption><img loading="lazy" src="${esc(relFromReport(card.oldOut))}"></figure>
      <figure><figcaption>Current</figcaption><img loading="lazy" src="${esc(relFromReport(card.newOut))}"></figure>
      <figure><figcaption>Diff</figcaption><img loading="lazy" src="${esc(relFromReport(card.diffOut))}"></figure>
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
  h1 { font-weight: 500; margin: 0 0 24px; }
  h2 { font-weight: 500; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  h2 .count { color: #888; font-size: 14px; margin-left: 8px; }
  .card { background: #16213e; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  .card h3 { font-size: 13px; margin: 0 0 10px; font-weight: 500; display: flex; gap: 12px; align-items: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .tag { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: #333; color: #fff; font-family: system-ui, sans-serif; letter-spacing: 0.5px; white-space: nowrap; }
  .images { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  img { width: 100%; border: 1px solid #333; border-radius: 4px; background: #0e0e24; display: block; }
</style>
</head><body>
<h1>Screenshot Diff Report</h1>
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
