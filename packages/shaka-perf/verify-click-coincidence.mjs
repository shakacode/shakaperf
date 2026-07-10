#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Cross-validate the two independent records of every audited click:
//
//   BLUE — the measured "click NNms" interaction chip. Since the
//   annotated-timeline moved chips out of the frame pixels ("Annotation
//   labels/rects are persisted as metadata and rendered later by React"),
//   the blue chips live in each test's artifacts/timeline_frames.json as
//   `pw-interaction` annotations pinned to a kept frame.
//
//   RED — the in-page "Click" overlay chip that interaction-overlay.ts
//   injects into the live page during recording. It IS baked into the
//   screencast pixels, so it's still read from the frame image
//   (bottom-right corner: find the red solid-colour bounding box, crop
//   tight to it, OCR with tesseract.js, grep for "click"). Tight cropping
//   is the difference between "chip dominates the field of view"
//   (tesseract reads it at ~90 % conf) and "chip is a postage stamp in
//   empty space" (tesseract returns "" or "."). Red key-press chips OCR
//   as their key name and deliberately don't match.
//
// The contract: the first and last blue-chip frames must each also carry
// a red Click overlay — i.e. the trace-derived interaction timing agrees
// with what the page visibly showed when the frame was captured.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const RESULTS = process.argv[2];
if (!RESULTS) {
  console.error('usage: verify-click-coincidence.mjs <audit-results-dir>');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-ocr-'));
process.on('exit', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const worker = await createWorker('eng', undefined, { logger: () => {} });
await worker.setParameters({
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',
});

// Lenient "click" matcher. Strict `\bclick\b` misses common OCR
// renderings of the chip text: "Blick" (B-for-C), "0lick" (zero-for-C),
// "clik" (lost-c), "cick" (lost-l), "Cllck" (i-as-l), "lck" with the
// 'i' chewed off, leading "| " punctuation from chip outline pixels,
// etc. Each variant preserves at least one of `lic|lik|ick|lck`; the
// key-name chips ("a", "Tab", "Shift", "Backspace") never contain any
// of these substrings, so the false-positive risk is negligible.
const CLICK_RE = /lic|lik|ick|lck/i;

const isRedChip = (r, g, b) => r > 200 && g < 100 && b < 100;

/**
 * Compute the bounding box of pixels matching `pred` within the given
 * fractional region of the frame image. Used to tightly crop the small red
 * chip in the bottom-right quadrant before OCR — loose crops drown
 * tesseract in empty pixels and it returns ""/".".
 */
async function bboxOf(imagePath, pred, region) {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, chan = info.channels;
  const x0 = Math.floor(W * region.left), x1 = Math.floor(W * region.right);
  const y0 = Math.floor(H * region.top), y1 = Math.floor(H * region.bottom);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * chan;
      if (pred(data[i], data[i + 1], data[i + 2])) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const PAD = 6;
  const left = Math.max(0, minX - PAD), top = Math.max(0, minY - PAD);
  return { left, top, width: Math.min(W, maxX + PAD) - left, height: Math.min(H, maxY + PAD) - top };
}

async function ocrRedCornerForClick(imagePath) {
  const meta = await sharp(imagePath).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  // Pre-paint 0.00ms blank frames and malformed images have degenerate
  // dimensions; treat as "no chip" rather than crash on extract.
  if (W < 40 || H < 40) return false;

  // Bottom-right chip: hunt for the red-coloured pixels in the
  // tight bottom-right corner and crop tight to them. The overlay
  // anchors the chip at `right: 24px; bottom: 24px` with vw-sized
  // dimensions sized against a nominal 720-wide page; the screencast
  // frames this script reads are downscaled to 500 px wide
  // (timeline_frame_*.webp — e.g. 500×314 desktop, 500×890 phone), so
  // the chip lands at ≈56 × 28 px, ≈17 px in from the corner — inside
  // the last 15 % (75 px) horizontally on every viewport, and well
  // inside 15 % vertically. Restricting the search to that corner
  // keeps red page content (product photos, "Featured" tags, hover
  // icons) out of the bounding box.
  const bbox = await bboxOf(imagePath, isRedChip, { left: 0.85, top: 0.85, right: 1, bottom: 1 });
  if (!bbox) return false;

  const out = path.join(tmpDir, 'br.png');
  // No try/catch around the sharp pipeline: this script is a verifier
  // and any sharp failure (degenerate crop from bboxOf, decoder
  // regression, truncated file, out-of-bounds extract) is a real bug
  // we want to surface as a stack trace — not silently swallow as
  // "no chip detected" and then report a green PASS on broken
  // captures.
  // Leave colour intact — the red chip empirically OCRs better straight
  // out of the frame than after preprocessing.
  await sharp(imagePath).extract(bbox).resize({ width: bbox.width * 4 }).png().toFile(out);
  for (const psm of ['6', '11', '8', '7']) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data: { text } } = await worker.recognize(out);
    if (CLICK_RE.test(text.toLowerCase())) return true;
  }
  return false;
}

const isClickChip = (a) => a.kind === 'pw-interaction' && /^click \d+(\.\d+)?ms$/.test(a.label);

let allPass = true;
let validatedCount = 0;
for (const sub of fs.readdirSync(RESULTS)) {
  const dir = path.join(RESULTS, sub, 'artifacts');
  const metadataPath = path.join(dir, 'timeline_frames.json');
  if (!fs.existsSync(metadataPath)) continue;
  const frames = [...JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))]
    .sort((a, b) => a.timeMs - b.timeMs);
  if (frames.length === 0) continue;
  // Tests with no clicks (pure-navigation flows) have nothing to
  // cross-validate — key presses render their key name, not "Click".
  if (!frames.some((fr) => (fr.annotations ?? []).some(isClickChip))) continue;
  validatedCount++;
  const blue = [], red = [];
  for (const fr of frames) {
    if ((fr.annotations ?? []).some(isClickChip)) blue.push(fr.timeMs);
    if (await ocrRedCornerForClick(path.join(dir, fr.imageFilename))) red.push(fr.timeMs);
  }
  // The contract is "every click's blue chip frame is also a red
  // overlay frame" — i.e. for each click we want to see both
  // annotations on the same captured frame. The interaction-overlay's
  // 25 ms hide window straddles 1-2 video frames at 60 fps and dedup
  // can keep neighbouring frames either side of the blue chip placement
  // (e.g. red rising before the chip lands, or lingering after). Those
  // extra red frames don't matter — the contract checks that the first
  // and last BLUE chip frames each also contain a red overlay.
  const firstOk = blue.length > 0 && red.includes(blue[0]);
  const lastOk = blue.length > 0 && red.includes(blue.at(-1));
  console.log(`\n${sub} (${frames.length} frames)`);
  console.log(`  blue clicks: ${blue.map((t) => t.toFixed(2)).join(', ') || '(none)'}`);
  console.log(`  red Clicks:  ${red.map((t) => t.toFixed(2)).join(', ') || '(none)'}`);
  console.log(`  first match: ${firstOk ? 'OK' : 'FAIL'} | last match: ${lastOk ? 'OK' : 'FAIL'}`);
  if (!firstOk || !lastOk) allPass = false;
}
await worker.terminate();
// A run that validated NOTHING must not pass: if the annotated-timeline
// stage stops emitting `pw-interaction` click annotations (or the label
// format drifts away from isClickChip), every test dir would skip and a
// bare `allPass` would report a vacuous PASS for the exact regression this
// script exists to catch.
if (validatedCount === 0) {
  console.log('\nFAIL: no test with click chips found in the metadata — nothing was validated');
  process.exit(1);
}
console.log(`\nvalidated ${validatedCount} test(s) with click chips`);
console.log(`${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
