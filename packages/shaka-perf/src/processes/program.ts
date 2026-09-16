/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import * as React from 'react';
import type * as Ink from 'ink';

// Ink v6 is ESM-only and shaka-perf is built as CJS. The Function constructor
// keeps tsc from rewriting `await import('ink')` into `require('ink')`, which
// would throw at runtime for an ESM-only package. Same trick as servers-menu.
const importInk: () => Promise<typeof Ink> =
  new Function('return import("ink")') as () => Promise<typeof Ink>;

export const PROCESS_MARKER_ENV_VAR = 'IS_SHAKA_PERF_PROCESS';
const PROCESS_MARKER_VALUE = 'true';

/**
 * Tag the current process (and every descendant it spawns) with an env var
 * so `shaka-perf processes list` can find them later. Call once at CLI entry.
 */
export function markCurrentProcess(): void {
  process.env[PROCESS_MARKER_ENV_VAR] = PROCESS_MARKER_VALUE;
}

type ShakaProcess = { pid: number; rssKB: number; command: string };

function listMarkedProcesses(): ShakaProcess[] {
  // BSD-style flags: a=all-users (will be filtered to own UID by env perms),
  // x=no-controlling-tty (background/detached procs), e=append-env-to-command,
  // ww=wide output, no truncation. Works on both Linux procps and macOS/BSD ps.
  const psArgs = ['axeww', '-o', 'pid=,rss=,command='];
  // Default maxBuffer is 1 MB, which can be exceeded easily — each process's
  // full environment block is appended to its line, and a busy system can
  // emit tens of MB.
  const raw = execFileSync('ps', psArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const marker = `${PROCESS_MARKER_ENV_VAR}=${PROCESS_MARKER_VALUE}`;
  // Filter out our own `ps` probe — it inherits the marker env from us.
  const probeCommand = `ps ${psArgs.join(' ')}`;
  const procs: ShakaProcess[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes(marker)) continue;
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    // Strip the trailing env dump from the command for display.
    const commandWithEnv = m[3];
    const envStart = commandWithEnv.search(/\s[A-Z_][A-Z0-9_]*=/);
    const command = envStart === -1 ? commandWithEnv : commandWithEnv.slice(0, envStart);
    if (command.trim() === probeCommand) continue;
    procs.push({ pid, rssKB: Number(m[2]), command });
  }
  return procs;
}

function formatRSS(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const WATCH_INTERVAL_MS = 1000;

function buildProcessesView(ink: typeof Ink, procs: ShakaProcess[]): React.ReactElement {
  const lines: React.ReactNode[] = [];
  if (procs.length === 0) {
    lines.push(React.createElement(ink.Text, { key: 'empty' }, 'No shaka-perf processes found.'));
  } else {
    const totalKB = procs.reduce((sum, p) => sum + p.rssKB, 0);
    lines.push(React.createElement(ink.Text, { key: 'h1' },
      `Found ${procs.length} shaka-perf process(es), ${formatRSS(totalKB)} RSS total:`));
    lines.push(React.createElement(ink.Text, { key: 'h2', bold: true },
      `  ${'PID'.padStart(7)}  ${'RSS'.padStart(10)}  COMMAND`));
    const termWidth = process.stdout.columns ?? 120;
    const prefixWidth = 2 + 7 + 2 + 10 + 2; // matches the format below
    const maxCommandWidth = Math.max(40, termWidth - prefixWidth);
    for (const p of procs) {
      const command = p.command.length > maxCommandWidth
        ? p.command.slice(0, maxCommandWidth - 1) + '…'
        : p.command;
      lines.push(React.createElement(ink.Text, { key: `p${p.pid}` },
        `  ${String(p.pid).padStart(7)}  ${formatRSS(p.rssKB).padStart(10)}  ${command}`));
    }
  }
  lines.push(React.createElement(ink.Text, { key: 'spacer' }, ' '));
  lines.push(React.createElement(ink.Text, { key: 'hint', dimColor: true },
    'Hint: run `shaka-perf processes kill-all` to clean up.'));
  return React.createElement(ink.Box, { flexDirection: 'column' }, ...lines);
}

async function watchAction(): Promise<void> {
  // Ink owns the redraw loop: differential diff, line clearing, cursor
  // management, terminal resize. Hand-rolled ANSI sequences were causing
  // flicker and stale tails on shorter lines. Same pattern as servers-menu.
  const ink = await importInk();
  let procs = listMarkedProcesses();
  const view = (): React.ReactElement => buildProcessesView(ink, procs);
  const instance = ink.render(view());
  const timer = setInterval(() => {
    procs = listMarkedProcesses();
    instance.rerender(view());
  }, WATCH_INTERVAL_MS);
  const stop = (): void => {
    clearInterval(timer);
    instance.unmount();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, stop);
  }
  await instance.waitUntilExit();
}

function killAllAction(): void {
  const procs = listMarkedProcesses();
  if (procs.length === 0) {
    console.log('No shaka-perf processes to kill.');
    return;
  }
  let killed = 0;
  for (const p of procs) {
    try {
      // SIGKILL, not SIGTERM — these are leaked processes by definition, so a
      // polite signal that they could trap and ignore defeats the point. We
      // tried SIGTERM first and node procs were surviving it.
      process.kill(p.pid, 'SIGKILL');
      killed++;
    } catch (err) {
      // ESRCH means the process is already gone between list and kill — fine.
      if ((err as Error & { code?: string }).code === 'ESRCH') continue;
      console.error(`  Failed to kill pid ${p.pid}: ${(err as Error).message}`);
    }
  }
  console.log(`Sent SIGKILL to ${killed}/${procs.length} process(es).`);
}

export function createProcessesCommand(): Command {
  const root = new Command('processes')
    .description(`Watch shaka-perf processes (marked via ${PROCESS_MARKER_ENV_VAR} env var)`)
    .action(watchAction);

  root.command('kill-all')
    .description('Kill all shaka-perf processes (SIGKILL)')
    .action(killAllAction);

  return root;
}
