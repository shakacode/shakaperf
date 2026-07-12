/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import type {
  ProxyRequest,
  ProxyResponse,
  ServerManifest,
} from './protocol';
import {
  EXIT_SERVER_DIED,
  FRAME_DELIMITER,
  PROTOCOL_VERSION,
} from './protocol';
import { endpointPaths } from './paths';

/**
 * Outcome of an attempted proxy. `proxied: true` means the server accepted
 * the request and produced an exit code — the caller must propagate `code`
 * and NOT also execute locally. `proxied: false` means we couldn't reach a
 * server (no manifest, dead pid, refused socket, version mismatch, …) and
 * the caller should fall back to local execution.
 */
export type ProxyAttemptOutcome =
  | { proxied: true; code: number; error?: string; data?: unknown }
  | { proxied: false; reason: string };

export interface TryProxyOptions {
  /** Project slug (same one used to namespace docker images + volumes). */
  slug: string;
  request: ProxyRequest;
  /** Verbose CLI flag — when set, fallback reasons are echoed to stderr. */
  verbose?: boolean;
}

/**
 * Attempt to hand the request off to a running `shaka-perf servers`. Designed
 * to make the fallback path the easy one: any disagreement, missing file, or
 * I/O error returns `{ proxied: false }` and the caller proceeds locally.
 *
 * The three liveness checks (manifest present, pid alive, socket accepting)
 * are intentionally independent because the server can die between any pair
 * of them — checking once and trusting the result would leak racy failures
 * back to the user.
 */
export async function tryProxy(opts: TryProxyOptions): Promise<ProxyAttemptOutcome> {
  const { slug, request, verbose } = opts;

  // The server sets this env var on itself at startup and forwards it
  // through `docker exec`, so any subprocess (host-side or in-container)
  // descended from a running `shaka-perf servers` bails out before
  // even reading the manifest. Without this gate, a setup command that
  // shells out to `shaka-perf` would dial back into the parent and
  // deadlock on its own session lock.
  if (process.env.SHAKAPERF_NO_PROXY === '1') {
    return logFallback({
      verbose,
      reason: 'inside a running shaka-perf servers — running locally',
    });
  }

  const paths = endpointPaths(slug);

  const manifest = readManifest(paths.manifest);
  if (!manifest) return logFallback({ verbose, reason: 'no running servers detected (no manifest)' });

  if (manifest.v !== PROTOCOL_VERSION) {
    return logFallback({
      verbose,
      reason: `manifest v${manifest.v}, this CLI speaks v${PROTOCOL_VERSION}`,
    });
  }

  // Belt-and-braces against a manifest written on another host (e.g. if a
  // user manually points `$XDG_RUNTIME_DIR` at an NFS-shared path). The
  // Unix socket can't actually be reached cross-host, but the PID number
  // in the manifest would *also* be live on this host and refer to an
  // unrelated process — we must not even try to signal it.
  const localHostname = os.hostname();
  if (manifest.hostname && manifest.hostname !== localHostname) {
    return logFallback({
      verbose,
      reason: `manifest hostname ${manifest.hostname} ≠ local ${localHostname}`,
    });
  }

  if (!isProcessAlive(manifest.pid)) {
    // Stale manifest from a crashed server — clean up so we don't keep
    // re-checking the same dead pid on every subsequent invocation.
    try { fs.unlinkSync(paths.manifest); } catch {}
    try { fs.unlinkSync(manifest.socketPath); } catch {}
    return logFallback({ verbose, reason: `manifest pid ${manifest.pid} is not running` });
  }

  return new Promise<ProxyAttemptOutcome>((resolve) => {
    const socket = net.connect({ path: manifest.socketPath });
    let buffer = '';
    let connected = false;
    let resolved = false;
    const finish = (outcome: ProxyAttemptOutcome) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      connected = true;
      // Notify the user the command is being handed off — otherwise the
      // local terminal looks frozen until the proxied action finishes
      // (which can be minutes for a build). Stderr so this doesn't get
      // mixed with the captured stdout of query subcommands; one plain
      // line, no color, no formatting libraries. The PID comes from the
      // already-validated manifest (we just confirmed it's alive on this
      // host) — no extra round-trip needed.
      process.stderr.write(
        `→ proxying to running \`shaka-perf servers\` (pid ${manifest.pid}) — output in that terminal\n`,
      );
      socket.write(JSON.stringify(request) + FRAME_DELIMITER);
      // Half-close so the server's read promise resolves on EOF for a
      // request that didn't quite send its trailing newline (paranoia).
      // The server uses `allowHalfOpen: true` so it can still write back.
      socket.end();
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf(FRAME_DELIMITER);
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      let frame: ProxyResponse;
      try {
        frame = JSON.parse(line) as ProxyResponse;
      } catch (err) {
        finish(logFallback({ verbose, reason: `malformed response: ${(err as Error).message}` }));
        return;
      }
      finish({ proxied: true, code: frame.code, error: frame.error, data: frame.data });
    });
    // Post-connect terminal events (`error`, `end` without an `exit` frame)
    // both mean "server died after accepting the request" — we MUST NOT
    // fall back to local because the action may have partially executed
    // server-side, and re-running would double-execute. Routing both
    // handlers through the same branch avoids a non-deterministic outcome
    // when a mid-dispatch crash fires both events. EXIT_SERVER_DIED (253)
    // gives the caller a distinguishable code; the message names which
    // event fired so server-side post-mortems still have detail.
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (connected) {
        finish({ proxied: true, code: EXIT_SERVER_DIED, error: `server died mid-dispatch (socket error: ${err.message})` });
      } else {
        finish(logFallback({ verbose, reason: `cannot connect to ${manifest.socketPath}: ${err.code ?? err.message}` }));
      }
    });
    socket.on('end', () => {
      finish({ proxied: true, code: EXIT_SERVER_DIED, error: 'server died mid-dispatch (closed connection without exit frame)' });
    });
  });
}

export async function requireBisectProxy<T>(options: TryProxyOptions): Promise<T> {
  const outcome = await tryProxy(options);
  if (!outcome.proxied) {
    throw new Error('compare bisect requires a running shaka-perf servers session');
  }
  if (outcome.code !== 0) {
    throw new Error(outcome.error ?? `Twin-server action exited ${outcome.code}`);
  }
  return outcome.data as T;
}

function readManifest(file: string): ServerManifest | null {
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { return JSON.parse(raw) as ServerManifest; } catch { return null; }
}

function isProcessAlive(pid: number): boolean {
  // `kill(pid, 0)` doesn't send a signal; it just probes whether the pid is
  // visible (alive and owned by this user). EPERM = exists but not ours,
  // ESRCH = gone. Treat EPERM as alive — even if we can't signal it, it IS
  // a running process and might be a server we shouldn't clobber.
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function logFallback(opts: { verbose?: boolean; reason: string }): ProxyAttemptOutcome {
  if (opts.verbose) {
    // Plain print, no color: this is best-effort diagnostic chatter, not an
    // error the user needs to read. The `helpers/ui.ts` palette doesn't have
    // a "gray/dim" entry, and we're not going to add one just for this line.
    console.error(`[ipc] running locally — ${opts.reason}`);
  }
  return { proxied: false, reason: opts.reason };
}
