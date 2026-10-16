#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Regenerate the frame-matching test fixtures from a real compare run.
//
//   yarn node scripts/make-frame-matching-fixtures.mjs <artifacts-dir> <fixture-name>
//
// <artifacts-dir> is a compare-results `.../artifacts` directory holding
// control_performance_profile.json + experiment_performance_profile.json.
// Those profiles are 3.5-10 MB and gitignored, so the fixtures keep only the
// deduped trace screenshots, re-encoded narrow enough to commit.
//
// The frames are what the product actually feeds the matcher, minus
// resolution: matches computed from these were verified identical to matches
// computed from the native-resolution frames.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { parseProfile, dedupeIdenticalScreenshots } from '../dist/bench/core/timeline-comparison.js';

// Wide enough to keep page structure legible to a 32x32 signature, narrow
// enough that a whole run costs tens of kilobytes.
const FIXTURE_WIDTH = 96;

const [artifactsDir, fixtureName] = process.argv.slice(2);
if (!artifactsDir || !fixtureName) {
  console.error('usage: make-frame-matching-fixtures.mjs <artifacts-dir> <fixture-name>');
  process.exit(2);
}

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bench', '__tests__', 'frame-fixtures');
const outDir = join(fixturesRoot, fixtureName);

async function writeSide(side) {
  const profilePath = join(artifactsDir, `${side}_performance_profile.json`);
  if (!existsSync(profilePath)) throw new Error(`missing ${profilePath}`);
  const frames = dedupeIdenticalScreenshots(parseProfile(profilePath).screenshots);
  const sideDir = join(outDir, side);
  rmSync(sideDir, { recursive: true, force: true });
  mkdirSync(sideDir, { recursive: true });
  const times = [];
  for (let i = 0; i < frames.length; i++) {
    const jpeg = await sharp(frames[i].snapshot)
      .resize(FIXTURE_WIDTH, null, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toBuffer();
    writeFileSync(join(sideDir, `${String(i).padStart(3, '0')}.jpg`), jpeg);
    times.push(Math.round(frames[i].timeMs * 100) / 100);
  }
  return times;
}

const control = await writeSide('control');
const experiment = await writeSide('experiment');
writeFileSync(
  join(outDir, 'frames.json'),
  `${JSON.stringify({ source: basename(resolve(artifactsDir, '..')), fixtureWidth: FIXTURE_WIDTH, control, experiment }, null, 2)}\n`,
);
console.log(`wrote ${control.length} control + ${experiment.length} experiment frames to ${outDir}`);
