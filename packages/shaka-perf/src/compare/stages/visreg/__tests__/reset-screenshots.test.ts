/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetVisregScreenshots } from '../run';

it('resets both screenshot pools without deleting other artifacts or sibling units', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-reset-'));
  const artifacts = path.join(root, 'phone', 'artifacts');
  const stale = ['control_screenshots/old.png', 'experiment_screenshots/old.png'];
  const retained = ['phone/artifacts/perf.json', 'phone/artifacts/control-visreg-failure-screenshot.png',
    'desktop/artifacts/control_screenshots/keep.png', 'desktop/artifacts/experiment_screenshots/keep.png',
    '.nyc_output/keep.json'];
  try {
    for (const file of [...stale.map((name) => path.join(artifacts, name)), ...retained.map((name) => path.join(root, name))]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, file);
    }
    resetVisregScreenshots(artifacts);
    for (const name of stale) expect(fs.existsSync(path.join(artifacts, name))).toBe(false);
    for (const name of retained) {
      const file = path.join(root, name);
      expect(fs.readFileSync(file, 'utf8')).toBe(file);
    }
    // Missing pools (including the ordinary fresh-run path) are harmless.
    expect(() => resetVisregScreenshots(artifacts)).not.toThrow();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
