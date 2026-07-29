/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Re-render timeline_frame_*.avif files from existing audit artifacts
// using the current dist code. Cuts the iteration loop from a 5+ min
// full audit to ~30 s per test.
import fs from 'node:fs';
import path from 'node:path';
import { generateProfileFramesSvg } from './dist/bench/core/timeline-comparison.js';

const ROOT = '/Users/romex/shakaperf_2/demo-ecommerce/audit-results';
const dirs = fs.readdirSync(ROOT)
  .map((d) => path.join(ROOT, d, 'artifacts'))
  .filter((d) => fs.existsSync(path.join(d, 'experiment_performance_profile.json')));

for (const dir of dirs) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('timeline_frame_') && f.endsWith('.avif')) fs.unlinkSync(path.join(dir, f));
  }
  const t0 = Date.now();
  await generateProfileFramesSvg({
    profilePath: path.join(dir, 'experiment_performance_profile.json'),
    outputPath: path.join(dir, 'timeline_frames.svg'),
  });
  console.log(`${path.basename(path.dirname(dir))}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
