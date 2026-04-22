#!/usr/bin/env node
/**
 * Builds a single HTML report pixelmatch-diffing every deep-click PNG under
 * `<suite>/report-shots/` against its git-HEAD version. Scoped to
 * `report-shots/` only — the per-artifact *.screenshot.png files (lighthouse,
 * timeline, diff HTMLs) live alongside for inspection but get no diff cards
 * because their iframe-driven renders have timing drift we don't care about.
 *
 * Usage:
 *   yarn node integration-tests/compare-screenshots.mjs
 *   yarn node integration-tests/compare-screenshots.mjs <dir> [<dir>...]
 *
 * Output:
 *   integration-tests/snapshots/screenshot-diff-report.html
 *   integration-tests/snapshots/.screenshot-diff/{old,diff}/…  (mirrored tree)
 *
 * Images are referenced via relative paths, not base64, so the HTML stays
 * small and the browser lazy-loads pairs as you scroll.
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_DIRS = [
  'integration-tests/snapshots/bench-results',
  'integration-tests/snapshots/visreg-results',
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

// Wipe prior working tree so stale old/diff PNGs don't linger
fs.rmSync(WORK_ROOT, { recursive: true, force: true });
fs.mkdirSync(WORK_ROOT, { recursive: true });

// Only diff deep-click captures from the compare-report drive-through — the
// "superficial" per-artifact *.screenshot.png files (lighthouse, timeline,
// diff HTMLs) live in the snapshot for inspection but aren't worth diffing
// because their underlying HTML iframes render with timing drift we don't
// care about.
const REPORT_SHOTS_DIR = 'report-shots';

function isInReportShots(filePath) {
  return filePath.split(path.sep).includes(REPORT_SHOTS_DIR);
}

function walkPngs(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip our own working tree so re-running doesn't fold old diffs
        // back in as "screenshots to diff".
        if (full === WORK_ROOT) continue;
        visit(full);
      } else if (entry.name.endsWith('.png') && isInReportShots(full)) {
        out.push(full);
      }
    }
  };
  visit(root);
  return out;
}

function pathsKnownToGit(root) {
  // Tracked (includes staged additions) + last-committed — some PNGs may be
  // staged-only, some committed, some both. Union of the two catches either.
  const tracked = safeGit(`git ls-files -- "${root}"`);
  const committed = safeGit(`git ls-tree --name-only -r HEAD -- "${root}"`);
  const all = [...tracked, ...committed]
    .filter((f) => f.endsWith('.png') && isInReportShots(f))
    .map((f) => path.normalize(f));
  return new Set(all);
}

function safeGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
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

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function relFromReport(p) {
  // Make src= paths relative to the HTML at integration-tests/snapshots/
  return path.relative(SNAPSHOTS_ROOT, p).split(path.sep).join('/');
}

function labelForDir(dir) {
  return path.basename(dir);
}

function sectionCards(dir) {
  const currentPaths = walkPngs(dir).sort();
  const gitPaths = pathsKnownToGit(dir);

  const currentSet = new Set(currentPaths.map(path.normalize));
  const union = new Set([...currentPaths, ...gitPaths]);
  const sorted = [...union].sort();

  const cards = [];
  for (const relOrAbs of sorted) {
    const relFromRepo = relOrAbs;
    const newPath = relFromRepo;
    const existsNow = currentSet.has(path.normalize(newPath));
    const existedBefore = gitPaths.has(path.normalize(newPath));

    // DELETED — existed at HEAD, gone now
    if (existedBefore && !existsNow) {
      const oldBuf = readHeadBuffer(relFromRepo);
      if (!oldBuf) continue;
      const oldPath = path.join(WORK_ROOT, 'old', relFromRepo);
      ensureDir(oldPath);
      fs.writeFileSync(oldPath, oldBuf);
      cards.push({
        status: 'DELETED',
        relPath: relFromRepo,
        oldPath,
      });
      continue;
    }

    // NEW — not in git yet
    if (existsNow && !existedBefore) {
      cards.push({
        status: 'NEW',
        relPath: relFromRepo,
        newPath,
      });
      continue;
    }

    // Both exist → pixelmatch
    const oldBuf = readHeadBuffer(relFromRepo);
    if (!oldBuf) continue;
    const newBuf = fs.readFileSync(newPath);

    const oldImg = PNG.sync.read(oldBuf);
    const newImg = PNG.sync.read(newBuf);

    const oldMirror = path.join(WORK_ROOT, 'old', relFromRepo);
    ensureDir(oldMirror);
    fs.writeFileSync(oldMirror, oldBuf);

    if (oldImg.width !== newImg.width || oldImg.height !== newImg.height) {
      cards.push({
        status: 'DIMENSIONS_CHANGED',
        relPath: relFromRepo,
        newPath,
        oldPath: oldMirror,
        oldDims: `${oldImg.width}×${oldImg.height}`,
        newDims: `${newImg.width}×${newImg.height}`,
      });
      continue;
    }

    const diff = new PNG({ width: oldImg.width, height: oldImg.height });
    const numDiffPixels = pixelmatch(
      oldImg.data,
      newImg.data,
      diff.data,
      oldImg.width,
      oldImg.height,
      { threshold: 0.1 },
    );
    const totalPixels = oldImg.width * oldImg.height;
    const pct = (numDiffPixels / totalPixels) * 100;

    const diffMirror = path.join(WORK_ROOT, 'diff', relFromRepo);
    ensureDir(diffMirror);
    fs.writeFileSync(diffMirror, PNG.sync.write(diff));

    cards.push({
      status: 'COMPARED',
      relPath: relFromRepo,
      newPath,
      oldPath: oldMirror,
      diffPath: diffMirror,
      numDiffPixels,
      pct,
    });
  }
  return cards;
}

const sections = targetDirs.map((d) => ({
  label: labelForDir(d),
  dir: d,
  cards: sectionCards(d),
}));

// Log what we found so a headless CI run shows the counts.
for (const s of sections) {
  const c = s.cards;
  const changed = c.filter((x) => x.status === 'COMPARED' && x.numDiffPixels > 0).length;
  const identical = c.filter((x) => x.status === 'COMPARED' && x.numDiffPixels === 0).length;
  const dim = c.filter((x) => x.status === 'DIMENSIONS_CHANGED').length;
  const neu = c.filter((x) => x.status === 'NEW').length;
  const del = c.filter((x) => x.status === 'DELETED').length;
  console.log(
    `${s.label}: ${c.length} total — ${changed} changed, ${identical} identical, ${dim} dim-shift, ${neu} new, ${del} deleted`,
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

function cardHtml(card) {
  const title = esc(card.relPath);
  if (card.status === 'DELETED') {
    return `<article class="card deleted" data-status="deleted">
      <h3>${title}<span class="tag tag--deleted">DELETED</span></h3>
      <div class="images">
        <figure><figcaption>Previous</figcaption><img loading="lazy" src="${esc(relFromReport(card.oldPath))}"></figure>
      </div>
    </article>`;
  }
  if (card.status === 'NEW') {
    return `<article class="card new" data-status="new">
      <h3>${title}<span class="tag tag--new">NEW</span></h3>
      <div class="images">
        <figure><figcaption>Current</figcaption><img loading="lazy" src="${esc(relFromReport(card.newPath))}"></figure>
      </div>
    </article>`;
  }
  if (card.status === 'DIMENSIONS_CHANGED') {
    return `<article class="card warn" data-status="dim">
      <h3>${title}<span class="tag tag--warn">DIMENSIONS ${esc(card.oldDims)} → ${esc(card.newDims)}</span></h3>
      <div class="images">
        <figure><figcaption>Previous</figcaption><img loading="lazy" src="${esc(relFromReport(card.oldPath))}"></figure>
        <figure><figcaption>Current</figcaption><img loading="lazy" src="${esc(relFromReport(card.newPath))}"></figure>
      </div>
    </article>`;
  }
  const pctFixed = card.pct.toFixed(2);
  const changed = card.numDiffPixels > 0;
  const cls = !changed ? 'ok' : card.pct > 5 ? 'warn' : 'mild';
  const statusAttr = !changed ? 'identical' : 'changed';
  const tag = !changed
    ? `<span class="tag tag--ok">identical</span>`
    : `<span class="tag tag--${cls}">${esc(pctFixed)}% · ${esc(card.numDiffPixels)}px</span>`;
  return `<article class="card ${cls}" data-status="${statusAttr}">
    <h3>${title}${tag}</h3>
    <div class="images">
      <figure><figcaption>Previous</figcaption><img loading="lazy" src="${esc(relFromReport(card.oldPath))}"></figure>
      <figure><figcaption>Current</figcaption><img loading="lazy" src="${esc(relFromReport(card.newPath))}"></figure>
      <figure><figcaption>Diff</figcaption><img loading="lazy" src="${esc(relFromReport(card.diffPath))}"></figure>
    </div>
  </article>`;
}

function sectionHtml(section) {
  const totals = {
    total: section.cards.length,
    changed: section.cards.filter((x) => x.status === 'COMPARED' && x.numDiffPixels > 0).length,
    identical: section.cards.filter((x) => x.status === 'COMPARED' && x.numDiffPixels === 0).length,
    dim: section.cards.filter((x) => x.status === 'DIMENSIONS_CHANGED').length,
    new: section.cards.filter((x) => x.status === 'NEW').length,
    deleted: section.cards.filter((x) => x.status === 'DELETED').length,
  };
  return `<section class="suite" data-suite="${esc(section.label)}">
    <header class="suite__head">
      <h2>${esc(section.label)}</h2>
      <div class="suite__stats">
        <span>${totals.total} total</span>
        <span class="stat changed">${totals.changed} changed</span>
        <span class="stat identical">${totals.identical} identical</span>
        ${totals.dim ? `<span class="stat warn">${totals.dim} dim-shift</span>` : ''}
        ${totals.new ? `<span class="stat new">${totals.new} new</span>` : ''}
        ${totals.deleted ? `<span class="stat deleted">${totals.deleted} deleted</span>` : ''}
      </div>
    </header>
    <div class="suite__cards">
      ${section.cards.map(cardHtml).join('\n')}
    </div>
  </section>`;
}

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Screenshot Diff Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 24px; }
  h1 { margin: 0 0 12px; font-weight: 500; }
  .top { display: flex; gap: 16px; align-items: baseline; margin-bottom: 24px; flex-wrap: wrap; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .filters button { background: #2a2a4a; color: #eee; border: 1px solid #3a3a5a; border-radius: 16px; padding: 4px 12px; cursor: pointer; font: inherit; }
  .filters button[data-active="true"] { background: #4a4a8a; border-color: #6a6aaa; }
  .suite { margin-bottom: 40px; }
  .suite__head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
  .suite__head h2 { margin: 0; font-weight: 500; }
  .suite__stats { display: flex; gap: 12px; font-size: 13px; color: #aaa; }
  .suite__stats .stat.changed { color: #ff9800; }
  .suite__stats .stat.identical { color: #4caf50; }
  .suite__stats .stat.warn { color: #ff9800; }
  .suite__stats .stat.new { color: #2196f3; }
  .suite__stats .stat.deleted { color: #f44336; }
  .suite__cards { display: flex; flex-direction: column; gap: 16px; }
  .card { background: #16213e; border-radius: 8px; padding: 12px 16px; border-left: 4px solid #555; }
  .card.ok { border-left-color: #4caf50; }
  .card.mild { border-left-color: #ffc107; }
  .card.warn { border-left-color: #ff9800; }
  .card.deleted { border-left-color: #f44336; }
  .card.new { border-left-color: #2196f3; }
  .card h3 { font-size: 13px; margin: 0 0 10px; font-weight: 500; display: flex; gap: 12px; align-items: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .tag { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: #333; color: #fff; font-family: system-ui, sans-serif; letter-spacing: 0.5px; white-space: nowrap; }
  .tag--ok { background: #2e7d32; }
  .tag--mild { background: #b28900; }
  .tag--warn { background: #e65100; }
  .tag--deleted { background: #c62828; }
  .tag--new { background: #1565c0; }
  .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  img { width: 100%; border: 1px solid #333; border-radius: 4px; background: #0e0e24; display: block; }
  .card[data-hidden="true"] { display: none; }
</style>
</head><body>
<h1>Screenshot Diff Report</h1>
<div class="top">
  <div class="filters">
    <button data-filter="all" data-active="true">all</button>
    <button data-filter="changed">changed only</button>
    <button data-filter="identical">identical only</button>
    <button data-filter="new">new</button>
    <button data-filter="deleted">deleted</button>
    <button data-filter="dim">dimension shifts</button>
  </div>
</div>
${sections.map(sectionHtml).join('\n')}
<script>
  const buttons = document.querySelectorAll('.filters button');
  const cards = document.querySelectorAll('.card');
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(x => x.dataset.active = 'false');
    b.dataset.active = 'true';
    const filter = b.dataset.filter;
    cards.forEach(c => {
      const s = c.dataset.status;
      const hide = filter !== 'all' && s !== filter;
      c.dataset.hidden = hide ? 'true' : 'false';
    });
  }));
</script>
</body></html>`;

fs.writeFileSync(REPORT_PATH, html);
console.log(`\nReport: ${REPORT_PATH}`);
