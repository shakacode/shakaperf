#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const pinnedFile = path.join(__dirname, '.node-path');
const cliEntry = path.join(__dirname, '..', 'dist', 'cli.js');

const globalNodeModules = path.resolve(__dirname, '..', '..');
const packageNodeModules = path.resolve(__dirname, '..', 'node_modules');
const nodePathParts = [globalNodeModules, packageNodeModules];
if (process.env.NODE_PATH) nodePathParts.push(process.env.NODE_PATH);
const nodePathEnv = nodePathParts.join(path.delimiter);

let nodeBin = process.env.SHAKA_PERF_NODE;
if (!nodeBin) {
  try {
    nodeBin = fs.readFileSync(pinnedFile, 'utf8').trim();
  } catch {
    nodeBin = process.execPath;
  }
}

if (!fs.existsSync(nodeBin)) {
  process.stderr.write(
    `shaka-perf: pinned Node binary "${nodeBin}" no longer exists. ` +
    `Reinstall shaka-perf, or override with SHAKA_PERF_NODE=/path/to/node.\n`,
  );
  process.exit(127);
}

// Tag the wrapper before spawnSync so `shaka-perf processes` can see it too
// — otherwise only the child cli.js shows up (markCurrentProcess in cli.ts
// only marks its own process). Long-running commands like `shaka-perf audit`
// keep this wrapper alive, so a leaked audit would otherwise have an
// invisible parent process. Keep this env var name in sync with
// PROCESS_MARKER_ENV_VAR in src/processes/program.ts.
process.env.IS_SHAKA_PERF_PROCESS = 'true';

const nodeArgs = ['--enable-source-maps'];

const result = spawnSync(nodeBin, [...nodeArgs, cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: nodePathEnv },
});
if (result.error) {
  process.stderr.write(`shaka-perf: failed to spawn ${nodeBin}: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
