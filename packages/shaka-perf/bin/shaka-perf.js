#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const cliEntry = path.join(__dirname, '..', 'dist', 'cli.js');

const globalNodeModules = path.resolve(__dirname, '..', '..');
const packageNodeModules = path.resolve(__dirname, '..', 'node_modules');
const nodePathParts = [globalNodeModules, packageNodeModules];
if (process.env.NODE_PATH) nodePathParts.push(process.env.NODE_PATH);
const nodePathEnv = nodePathParts.join(path.delimiter);

// Mark the env BEFORE spawnSync so the child cli.js carries the marker in its
// initial environment block, which is what `ps axeww` (and so `shaka-perf
// processes`) reads. markCurrentProcess in cli.ts mutates process.env
// in-process, which its own descendants inherit but `ps` never shows for that
// process itself - so without this line a leaked `shaka-perf audit` would be
// invisible. (This wrapper's own ps line stays unmarked for the same reason;
// only a parent shell could mark it.) Keep the name in sync with
// PROCESS_MARKER_ENV_VAR in src/processes/program.ts. SHAKA_PERF_VERSION is
// deliberately NOT set here: cli.ts publishes it before any test file loads.
process.env.IS_SHAKA_PERF_PROCESS = 'true';

const nodeArgs = ['--enable-source-maps'];

// Node raises MODULE_TYPELESS_PACKAGE_JSON for every `.ts` file it strips types
// from whose nearest package.json declares no `"type"` — i.e. for the
// `abtests.config.ts` / `.abtest.ts` files the config loader imports natively,
// in most consumers: a Rails/webpack project's package.json is CommonJS, and
// taking the warning's advice ("add `"type": "module"`") would break it.
// Loading their files that way is our decision, not their mistake, and the
// warning lands on the stderr of EVERY invocation — including the
// `shaka-perf troubleshoot` subcommands, whose whole contract is printing a
// value and nothing else. It is raised on Node's loader thread, so no
// in-process filter can intercept it; this flag is the only lever. Probed
// rather than assumed because `engines` still allows Node 20.6, and
// `--disable-warning` landed in 20.11 — an unknown flag would abort the spawn.
if (process.allowedNodeEnvironmentFlags.has('--disable-warning')) {
  nodeArgs.push('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON');
}

const result = spawnSync(process.execPath, [...nodeArgs, cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: nodePathEnv },
});
if (result.error) {
  process.stderr.write(`shaka-perf: failed to spawn ${process.execPath}: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
