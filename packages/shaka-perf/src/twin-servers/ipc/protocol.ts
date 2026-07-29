/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BuildTarget } from '../commands/build';

/**
 * Container-side selector. Every twin-servers command that names a single
 * container takes one of these two; we duplicate it here (rather than
 * importing `ServerTarget` from one of `run-cmd.ts` / `run-overmind-command.ts`
 * / `sync-changes.ts`, where it appears under three different names) so the
 * wire protocol stays self-contained.
 */
export type ProxyTarget = 'control' | 'experiment';

/**
 * Wire protocol version. Bumped on any breaking change to the request or
 * response shapes. Clients refuse to proxy against a server with a different
 * `PROTOCOL_VERSION` and fall back to direct execution — preferable to a
 * mysterious failure deep inside a request the server can't parse.
 */
export const PROTOCOL_VERSION = 2 as const;

/**
 * Frames are line-delimited JSON over a Unix domain socket. Each frame is a
 * single JSON object terminated by `\n`; no escaping needed because JSON.encode
 * itself cannot emit a bare newline.
 */
export const FRAME_DELIMITER = '\n';

export interface BaseRequestEnvelope {
  v: typeof PROTOCOL_VERSION;
}

/**
 * Variant slice of a ProxyRequest — the command name plus its own arguments.
 * Pulled out so callers can build a payload once and let a helper wrap it in
 * the common envelope (`v`). Each variant maps to a *menu-aware* operation
 * rather than the raw action function — so e.g. `build` rebuilds AND restarts
 * overmind, and `start-containers` restarts both containers and overmind
 * (containers are recreated from the image, so any in-container state is
 * reset). `sync-changes` is proxy-eligible only so it can return a clear
 * "the running menu already auto-syncs the build context" error.
 *
 * Deliberately excluded (always local-only): `get-config` (pure read — the
 * value belongs on the caller's stdout); `say`, `notify-server-started`,
 * `run-overmind-command` (Procfile / TTS helpers); `copy-changes-to-ssh`,
 * `forward-ports`, `customize-docker-compose` (dev convenience scaffolds).
 */
export type ProxyRequestPayload =
  | { cmd: 'build'; target?: BuildTarget; noCache: boolean }
  | { cmd: 'start-containers' }
  | { cmd: 'stop-containers' }
  | { cmd: 'start-servers' }
  | { cmd: 'run-cmd'; target: ProxyTarget; shellCommand: string }
  | { cmd: 'run-cmd-parallel'; shellCommand: string }
  | { cmd: 'sync-changes'; target: ProxyTarget }
  | { cmd: 'bisect-begin'; sessionId: string; ownerPid: number }
  | {
    cmd: 'bisect-refresh';
    sessionId: string;
    mode: 'commands' | 'container';
    rebuildCommands: string[];
    noCache: boolean;
  }
  | { cmd: 'bisect-end'; sessionId: string };

export type ProxyRequest = BaseRequestEnvelope & ProxyRequestPayload;

/**
 * Server → client response. There is exactly one terminal frame per
 * connection — no streaming progress, no separate `hello` / `busy` /
 * `rejected` discriminators. Action outcome is encoded in `code`:
 *
 *   0   — action ran and succeeded.
 *   1   — action ran and threw a normal error (message in `error`).
 *   2   — request never dispatched (protocol mismatch, malformed frame,
 *         unknown `cmd` from a newer-than-server client). The client treats
 *         this as "fall back to local execution" so an older server doesn't
 *         hard-fail a request a newer client could have run locally.
 *   75  — `EX_TEMPFAIL`: menu is shutting down or hasn't finished booting.
 *         Client surfaces it verbatim — caller decides whether to retry.
 *   253 — server died between accepting the request and sending an `exit`
 *         frame. SYNTHESISED by the client when the socket closes without
 *         a terminal frame post-connect; the server itself cannot send 253.
 *         The action MAY have partially executed, so the client does NOT
 *         fall back to local (that would risk double-execution).
 *
 * Logs are intentionally NOT streamed back — the whole point of proxying is
 * that the action's stdout lands in the server's terminal, not the client's.
 * The client just blocks on `exit` and propagates the code.
 */
export const EXIT_OK = 0 as const;
export const EXIT_ACTION_ERROR = 1 as const;
export const EXIT_NEVER_DISPATCHED = 2 as const;
export const EXIT_MENU_BUSY = 75 as const;
export const EXIT_SERVER_DIED = 253 as const;

export interface ProxyResponse {
  event: 'exit';
  code: number;
  error?: string;
  data?: unknown;
}

/**
 * Thrown by the dispatcher when the request's `cmd` falls through the
 * switch — i.e. a newer client at the same PROTOCOL_VERSION added a command
 * this server doesn't know yet. The server maps it to `EXIT_NEVER_DISPATCHED`
 * (2) so the client falls back to local execution instead of hard-failing
 * with a confusing "unknown proxied cmd" exit 1.
 */
export class UnknownCommandError extends Error {
  constructor(cmd: string) {
    super(`unknown proxied cmd: ${cmd}`);
    this.name = 'UnknownCommandError';
  }
}

/**
 * Manifest written to `$XDG_RUNTIME_DIR/shaka-perf/<slug>/server.json` by
 * the running server so subcommands can discover it. Versioning lives on
 * the manifest so a future schema change doesn't trip up older `shaka-perf`
 * binaries reading a manifest written by a newer one — they bail and run
 * locally. Everything else is the minimum the client needs to safely
 * connect; debug fields (cwd, config path, start time, slug) used to live
 * here too but they were purely cosmetic.
 */
export interface ServerManifest {
  v: typeof PROTOCOL_VERSION;
  pid: number;
  socketPath: string;
  /**
   * `os.hostname()` of the machine that wrote this manifest. The endpoint
   * already lives in a host-local runtime dir, so a mismatch is unusual —
   * but it'd happen if a user manually points `$XDG_RUNTIME_DIR` at an
   * NFS-mounted path. Clients refuse to proxy on mismatch and fall back to
   * local execution.
   */
  hostname: string;
}
