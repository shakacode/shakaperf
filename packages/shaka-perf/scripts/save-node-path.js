/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'bin', '.node-path');
try {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, process.execPath);
} catch (err) {
  process.stderr.write(`shaka-perf: could not pin Node path (${err.message}); falling back to active Node at runtime.\n`);
}
