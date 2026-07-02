#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const target = path.join(os.homedir(), '.local', 'bin', 'shaka-perf');

mkdirSync(path.dirname(target), { recursive: true });

const pnpCjs = path.join(repoRoot, '.pnp.cjs');
const pnpLoader = path.join(repoRoot, '.pnp.loader.mjs');
const cliEntry = path.join(pkgDir, 'dist', 'cli.js');

// NODE_OPTIONS propagates to worker_threads and child node processes;
// CLI flags do not. esbuild's main.js spawns a worker that resolves its
// native binary via require.resolve, so the worker must also load PnP —
// otherwise it falls back to Node's default node_modules walk from cwd
// and fails when invoked from outside the shaka-perf tree.
const wrapper = `#!/usr/bin/env bash
# Dev shaka-perf — runs the workspace build with Yarn PnP loaded.
# Re-generate with: yarn workspace shaka-perf install-global
export NODE_OPTIONS="--require ${pnpCjs} --experimental-loader ${pnpLoader}\${NODE_OPTIONS:+ $NODE_OPTIONS}"
# Export the marker BEFORE exec so /proc/PID/environ reflects it — Node's
# in-process \`process.env\` mutation (markCurrentProcess) doesn't update the
# kernel's env block, which is what \`ps axeww\` reads.
export IS_SHAKA_PERF_PROCESS=true
# Authenticate the bundled claude CLI calls (ai_summary, accessibility,
# agent-readiness, warm/cold email) with a Claude subscription token saved at
# ~/.claude-oat-token via 'claude setup-token'. A session ANTHROPIC_BASE_URL
# gateway rejects that token, so drop it for these child processes. Fully a
# no-op when that file is absent or empty, so an API-key (ANTHROPIC_API_KEY) or
# normally logged-in claude is untouched.
if [ -r "$HOME/.claude-oat-token" ]; then
  _oat="$(tr -d '[:space:]' < "$HOME/.claude-oat-token")"
  if [ -n "$_oat" ]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$_oat"
    unset ANTHROPIC_BASE_URL
  fi
  unset _oat
fi
exec "${process.execPath}" "${cliEntry}" "$@"
`;

writeFileSync(target, wrapper);
chmodSync(target, 0o755);
process.stdout.write(`installed ${target}\n`);
