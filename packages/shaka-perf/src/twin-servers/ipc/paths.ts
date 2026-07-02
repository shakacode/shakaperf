/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Well-known locations for IPC discovery.
 *
 * The endpoint **must** live in a host-local directory: the Unix socket is
 * a kernel-local FS object that can't actually be connected to from another
 * machine, so if the surrounding manifest is visible on a second host
 * (e.g. an NFS-mounted `$HOME`) clients there would happily try to proxy
 * into a PID that has a totally different meaning locally. We dodge that
 * entirely by picking a per-user, host-local runtime dir:
 *
 *   1. `$XDG_RUNTIME_DIR/shaka-perf/<slug>/` — the systemd-managed
 *      `/run/user/<uid>/` on modern Linux, tmpfs-backed and never shared.
 *   2. `os.tmpdir()/shaka-perf-<uid>/<slug>/` — fallback for macOS/BSD
 *      where XDG_RUNTIME_DIR isn't set. `/tmp` is host-local on every
 *      sensible setup (it's tmpfs on Linux, the boot volume on macOS),
 *      never NFS-shared. The `<uid>` suffix prevents multiple users on a
 *      shared box from colliding inside the same tmp.
 *
 * `slug` is the same project-path slug used for Docker image names and
 * host bind dirs (see `projectPathSlug`), so two checkouts on the same
 * host don't collide either.
 *
 *   server.json — JSON manifest: { pid, socketPath, hostname, … }.
 *                 The hostname field is the belt-and-braces check the
 *                 client runs in case someone manually points
 *                 XDG_RUNTIME_DIR at something shared.
 *   server.sock — Unix domain socket the running `shaka-perf servers`
 *                 listens on. Stored *inside* the manifest rather than
 *                 derived, so a future move (e.g. shorter path to dodge
 *                 sun_path's 104-char limit) doesn't break older clients
 *                 that still know about the directory.
 */
export interface ServerEndpointPaths {
  dir: string;
  manifest: string;
  socket: string;
}

export function endpointPaths(slug: string): ServerEndpointPaths {
  const base = runtimeBase();
  const dir = path.join(base, slug);
  const regularSocket = path.join(dir, 'server.sock');
  return {
    dir,
    manifest: path.join(dir, 'server.json'),
    socket: regularSocket.length <= 100 ? regularSocket : shortSocketPath(slug),
  };
}

function runtimeBase(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) return path.join(xdg, 'shaka-perf');
  // `getuid` is Unix-only and not in Node's Windows API; shaka-perf is
  // macOS/Linux only, but the optional chain keeps the type checker happy
  // and gives a sane fallback if it's ever called without one.
  const uid = process.getuid?.() ?? 'shared';
  return path.join(os.tmpdir(), `shaka-perf-${uid}`);
}

function shortSocketPath(slug: string): string {
  const uid = process.getuid?.() ?? 'shared';
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, 16);
  const tmp = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  return path.join(tmp, `shaka-perf-${uid}-sockets`, `${hash}.sock`);
}
