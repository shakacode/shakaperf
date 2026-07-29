/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ResolvedConfig } from '../types';
import type {
  ProxyRequest,
  ProxyResponse,
  ServerManifest,
} from './protocol';
import {
  EXIT_ACTION_ERROR,
  EXIT_MENU_BUSY,
  EXIT_NEVER_DISPATCHED,
  EXIT_OK,
  FRAME_DELIMITER,
  PROTOCOL_VERSION,
  UnknownCommandError,
} from './protocol';
import { endpointPaths } from './paths';
import { MenuBusyError } from '../commands/servers-menu';

/** Dispatcher resolves a request into a runnable action. */
export type ProxyDispatcher = (req: ProxyRequest) => Promise<unknown>;

export interface ProxyServer {
  /** Tear down the listener and remove the manifest + socket. */
  close: () => Promise<void>;
}

export interface StartProxyServerOptions {
  config: ResolvedConfig;
  dispatch: ProxyDispatcher;
}

/**
 * Start the IPC server alongside an interactive `shaka-perf servers` so that
 * subcommands launched from other terminals can proxy into this process. On
 * success, writes `~/.shaka-perf/<slug>/server.json` and listens on the
 * matching socket; on `close()`, unlinks both.
 *
 * Failure to bind (typically: another shaka-perf servers already running for
 * this same slug, or a stale socket file) throws — the caller decides
 * whether to abort startup or proceed without the proxy. We don't silently
 * eat the error because the absence of a proxy would surprise the user.
 */
export async function startProxyServer(opts: StartProxyServerOptions): Promise<ProxyServer> {
  const { config, dispatch } = opts;
  const paths = endpointPaths(config.projectSlug);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.socket), { recursive: true });

  // A stale socket from a previous crash will make `listen` fail with
  // EADDRINUSE — first check whether anyone is actually listening on it, and
  // if not, unlink and retry. Mirror's how unix daemons handle their
  // PID/socket files.
  await unlinkIfStale(paths.socket);

  // `allowHalfOpen: true` is the critical bit: clients half-close their write
  // side (via `socket.end()`) immediately after sending the request so the
  // server's read promise resolves promptly. Without this flag Node's default
  // is to AUTO-CLOSE the server's writable side the moment the client's
  // read side ends — which would happen mid-dispatch and silently drop the
  // `exit` frame we try to write afterwards. Symptom on the client side:
  // "server closed connection without exit frame" after an action that
  // actually succeeded.
  //
  // Connection-level concurrency is no longer gated here — the menu
  // controller's session lock is the single source of truth for "one
  // action at a time", and proxied requests queue on it rather than
  // bouncing. See [[mutex queue rationale]] in `servers-menu.ts`.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    void handleConnection(socket, { config, dispatch });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(paths.socket);
  });

  // Permission 0600: only the owning user can connect. The socket file
  // inherits the directory's umask by default — explicit `chmod` is the
  // belt-and-braces that documents the intent.
  fs.chmodSync(paths.socket, 0o600);

  const manifest: ServerManifest = {
    v: PROTOCOL_VERSION,
    pid: process.pid,
    socketPath: paths.socket,
    hostname: os.hostname(),
  };
  fs.writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2));

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    // Best-effort cleanup; ignore ENOENT (someone else may have wiped them).
    try { fs.unlinkSync(paths.manifest); } catch {}
    try { fs.unlinkSync(paths.socket); } catch {}
  };

  return { close };
}

interface ConnectionContext {
  config: ResolvedConfig;
  dispatch: ProxyDispatcher;
}

async function handleConnection(socket: net.Socket, ctx: ConnectionContext): Promise<void> {
  // Single-request-per-connection — keeps the protocol trivially stateless
  // and means a misbehaving client can't pin a long-lived slot on the
  // server. Read until the first newline, dispatch, send one `exit` frame,
  // close. The client controls which condition counts as success via the
  // exit code (0 OK, 1 action error, 2 protocol error, 75 menu temp-fail).
  const exit = (code: number, error?: string, data?: unknown): void => {
    if (socket.writable) {
      socket.write(JSON.stringify({ event: 'exit', code, error, data } satisfies ProxyResponse) + FRAME_DELIMITER);
    }
    socket.end();
  };

  let buffer = '';
  socket.setEncoding('utf8');

  // We resolve on the first newline. The 'end' branch only fires when the
  // client closes its write side BEFORE sending a delimiter — treat that
  // as a malformed request without trying to parse the dangling buffer.
  const request = await new Promise<ProxyRequest | { error: string }>((resolve) => {
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf(FRAME_DELIMITER);
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      try {
        resolve(JSON.parse(line) as ProxyRequest);
      } catch (err) {
        resolve({ error: `malformed request: ${(err as Error).message}` });
      }
    });
    socket.on('end', () => resolve({ error: 'client closed before sending a request' }));
    socket.on('error', (err) => resolve({ error: `socket error: ${err.message}` }));
  });

  if ('error' in request) {
    exit(EXIT_NEVER_DISPATCHED, request.error);
    return;
  }
  if (request.v !== PROTOCOL_VERSION) {
    exit(EXIT_NEVER_DISPATCHED, `protocol mismatch: server v${PROTOCOL_VERSION}, client v${request.v}`);
    return;
  }

  try {
    const data = await ctx.dispatch(request);
    exit(EXIT_OK, undefined, data);
  } catch (err) {
    // Typed errors get their own exit code so the client can react:
    //  • MenuBusyError       → EX_TEMPFAIL (75); caller decides whether to retry.
    //  • UnknownCommandError → 2 (never-dispatched); client falls back to local
    //    so a newer-client / older-server skew at the same protocol version
    //    doesn't hard-fail what could have run locally.
    // Anything else is a normal action failure on exit 1.
    if (err instanceof MenuBusyError) {
      exit(EXIT_MENU_BUSY, err.message);
    } else if (err instanceof UnknownCommandError) {
      exit(EXIT_NEVER_DISPATCHED, err.message);
    } else {
      exit(EXIT_ACTION_ERROR, err instanceof Error ? err.message : String(err));
    }
  }
}

async function unlinkIfStale(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  // Try to connect: if a server is alive, `connect` succeeds (or the
  // connection is accepted), in which case the path is NOT stale and the
  // caller should fail loud rather than blow away a live socket. Otherwise
  // we get ECONNREFUSED or ENOENT and can safely unlink.
  const isStale = await new Promise<boolean>((resolve) => {
    const probe = net.connect({ path: socketPath });
    probe.once('connect', () => { probe.end(); resolve(false); });
    probe.once('error', (err: NodeJS.ErrnoException) => {
      probe.destroy();
      resolve(err.code === 'ECONNREFUSED' || err.code === 'ENOENT');
    });
  });
  if (isStale) {
    try { fs.unlinkSync(socketPath); } catch {}
    // Also nuke a stale manifest if it sits next to the stale socket.
    const manifest = path.join(path.dirname(socketPath), 'server.json');
    try { fs.unlinkSync(manifest); } catch {}
  }
}
