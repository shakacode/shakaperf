#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Verify the first/last red "Click" overlay frame coincides with the
// first/last blue "click NNms" chip frame, in every test's kept AVIFs.
//
// For each AVIF: find the chip's solid-colour bounding box (blue chip in
// the top half, red chip in the bottom-right quadrant), crop tight to it,
// OCR with tesseract.js, grep `\bclick\b`. Tight cropping is the
// difference between "chip dominates the field of view" (tesseract reads
// it at ~90 % conf) and "chip is a postage stamp in empty space"
// (tesseract returns "" or "."). Page colour decorations elsewhere are
// excluded by quadrant restriction.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const RESULTS = process.argv[2] ?? '/Users/romex/shakaperf_2/demo-ecommerce/audit-results';

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
 * fractional region of the AVIF. Used to tightly crop the small red
 * chip in the bottom-right quadrant before OCR — loose crops drown
 * tesseract in empty pixels and it returns ""/".".
 */
async function bboxOf(avifPath, pred, region) {
  const { data, info } = await sharp(avifPath).raw().toBuffer({ resolveWithObject: true });
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

async function ocrCornerForClick(avifPath, corner) {
  const meta = await sharp(avifPath).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  // Pre-paint 0.00ms blank frames and malformed AVIFs have degenerate
  // dimensions; treat as "no chip" rather than crash on extract.
  if (W < 40 || H < 40) return false;

  let crop;
  if (corner === 'tl') {
    // Top-left chip strip: 35 % wide × 15 % tall, anchored at (0,0).
    // 15 % at 450 px = 67 px — fits the chip (~50 px tall in 720-wide
    // screencast) and clears the Orders / side-panel blue rectangles
    // that live 80+ px down, which the broader 35×35 crop swept in
    // and turned into noise.
    crop = {
      left: 0, top: 0,
      width: Math.min(W, Math.round(W * 0.35)),
      height: Math.min(H, Math.round(H * 0.15)),
    };
  } else {
    // Bottom-right chip: hunt for the red-coloured pixels in the
    // tight bottom-right corner and crop tight to them. The overlay
    // anchors the chip at `right: 24px; bottom: 24px` with vw-sized
    // dimensions ≈80 × 40 px in the 720-wide screencast; restricting
    // the search to the last 15 % × 15 % keeps red product photos
    // (apple-watch faces, "Featured" tags, hover icons) out of the
    // bounding box. The chip lives entirely inside this corner for
    // every viewport (desktop 720 × 450 and phone 720 × 1280).
    const bbox = await bboxOf(avifPath, isRedChip, { left: 0.85, top: 0.85, right: 1, bottom: 1 });
    if (!bbox) return false;
    crop = bbox;
  }

  const out = path.join(tmpDir, `${corner}.png`);
  // No try/catch around the sharp pipeline: this script is a verifier
  // and any sharp failure (degenerate crop from bboxOf, decoder
  // regression, truncated file, out-of-bounds extract) is a real bug
  // we want to surface as a stack trace — not silently swallow as
  // "no chip detected" and then report a green PASS on broken
  // captures.
  let pipe = sharp(avifPath).extract(crop).resize({ width: crop.width * 4 });
  if (corner === 'tl') {
    // Top-left blue chip: grayscale → threshold@200 → negate. White
    // chip text (luma 255) and white page bg both clear the threshold;
    // the blue chip bg (luma ~110) and any dark page text drop to 0.
    // After negate, the chip becomes BLACK TEXT ON WHITE — tesseract's
    // native expectation — while the rest of the crop inverts to
    // unreadable white-on-black so the chip dominates.
    pipe = pipe.grayscale().threshold(200).negate({ alpha: false });
  }
  // Bottom-right red chip: leave colour intact — empirically OCRs
  // better straight out of the AVIF at PSM 11 than after preprocessing.
  await pipe.png().toFile(out);
  for (const psm of ['6', '11', '8', '7']) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data: { text } } = await worker.recognize(out);
    if (CLICK_RE.test(text.toLowerCase())) return true;
  }
  return false;
}

let allPass = true;
for (const sub of fs.readdirSync(RESULTS)) {
  const dir = path.join(RESULTS, sub, 'artifacts');
  if (!fs.existsSync(dir)) continue;
  const frames = fs.readdirSync(dir)
    .filter((f) => f.startsWith('timeline_frame_') && f.endsWith('.avif'))
    .map((f) => ({ file: f, timeMs: parseFloat(f.match(/_(\d+\.\d+)ms\.avif$/)?.[1] ?? '0') }))
    .sort((a, b) => a.timeMs - b.timeMs);
  if (frames.length === 0) continue;
  const blue = [], red = [];
  for (const fr of frames) {
    const p = path.join(dir, fr.file);
    if (await ocrCornerForClick(p, 'tl')) blue.push(fr.timeMs);
    if (await ocrCornerForClick(p, 'br')) red.push(fr.timeMs);
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
console.log(`\n${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
