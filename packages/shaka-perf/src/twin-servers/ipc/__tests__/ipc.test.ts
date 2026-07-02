/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startProxyServer, type ProxyDispatcher } from '../server';
import { tryProxy } from '../client';
import { endpointPaths } from '../paths';
import { PROTOCOL_VERSION } from '../protocol';
import { MenuBusyError } from '../../commands/servers-menu';
import type { ResolvedConfig } from '../../types';

/**
 * IPC discovery lives under `$XDG_RUNTIME_DIR/shaka-perf/<slug>/` (host-local,
 * per-user runtime dir — see `ipc/paths.ts`). The tests need a real Unix
 * socket on disk, so we redirect the runtime dir to a per-test tmpdir to
 * keep stray sockets from any real `shaka-perf servers` the dev may have
 * running.
 */
function withHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-runtime-'));
  const originalXdg = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = originalXdg;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });
}

function fakeConfig(slug: string): ResolvedConfig {
  return { projectSlug: slug } as unknown as ResolvedConfig;
}

describe('ipc proxy', () => {
  it('proxies a request to the running server and returns its exit code', async () => {
    await withHome(async () => {
      const slug = 'unit-1';
      const dispatched: Array<{ cmd: string }> = [];
      const dispatch: ProxyDispatcher = async (req) => {
        dispatched.push({ cmd: req.cmd });
      };

      const proxy = await startProxyServer({
        config: fakeConfig(slug),
        dispatch,
      });

      try {
        const outcome = await tryProxy({
          slug,
          request: { v: PROTOCOL_VERSION, cmd: 'start-containers' },
        });
        expect(outcome).toEqual({ proxied: true, code: 0 });
        expect(dispatched).toEqual([{ cmd: 'start-containers' }]);
      } finally {
        await proxy.close();
      }
    });
  });

  it('reports the action failure as a non-zero proxied exit', async () => {
    await withHome(async () => {
      const slug = 'unit-2';
      const dispatch: ProxyDispatcher = async () => {
        throw new Error('boom');
      };
      const proxy = await startProxyServer({
        config: fakeConfig(slug),
        dispatch,
      });
      try {
        const outcome = await tryProxy({
          slug,
          request: { v: PROTOCOL_VERSION, cmd: 'stop-containers' },
        });
        expect(outcome).toEqual({ proxied: true, code: 1, error: 'boom' });
      } finally {
        await proxy.close();
      }
    });
  });

  it('bails out via SHAKAPERF_NO_PROXY before reading the manifest', async () => {
    await withHome(async () => {
      const slug = 'no-proxy';
      const dispatch: ProxyDispatcher = async () => {
        throw new Error('dispatcher must not run');
      };
      const proxy = await startProxyServer({ config: fakeConfig(slug), dispatch });
      const previous = process.env.SHAKAPERF_NO_PROXY;
      process.env.SHAKAPERF_NO_PROXY = '1';
      try {
        const outcome = await tryProxy({
          slug,
          request: { v: PROTOCOL_VERSION, cmd: 'start-containers' },
        });
        expect(outcome.proxied).toBe(false);
        if (!outcome.proxied) expect(outcome.reason).toMatch(/inside a running/i);
      } finally {
        if (previous === undefined) delete process.env.SHAKAPERF_NO_PROXY;
        else process.env.SHAKAPERF_NO_PROXY = previous;
        await proxy.close();
      }
    });
  });

  it('falls back to local execution when no manifest exists', async () => {
    await withHome(async () => {
      const outcome = await tryProxy({
        slug: 'never-started',
        request: { v: PROTOCOL_VERSION, cmd: 'start-containers' },
      });
      expect(outcome.proxied).toBe(false);
      if (!outcome.proxied) {
        expect(outcome.reason).toMatch(/no manifest/);
      }
    });
  });

  it('falls back and cleans up when the manifest points at a dead pid', async () => {
    await withHome(async () => {
      const slug = 'stale-pid';
      const paths = endpointPaths(slug);
      fs.mkdirSync(paths.dir, { recursive: true });
      // Pick a pid we're confident is not in use. `process.pid + 999_999` is
      // outside the normal pid_max on every supported platform, so the
      // liveness probe must report "not running".
      const deadPid = process.pid + 999_999;
      fs.writeFileSync(paths.manifest, JSON.stringify({
        v: PROTOCOL_VERSION,
        pid: deadPid,
        socketPath: paths.socket,
        hostname: os.hostname(),
      }));

      const outcome = await tryProxy({
        slug,
        request: { v: PROTOCOL_VERSION, cmd: 'start-containers' },
      });
      expect(outcome.proxied).toBe(false);
      // Stale manifest should be unlinked so the next call doesn't repeat
      // the pid probe.
      expect(fs.existsSync(paths.manifest)).toBe(false);
    });
  });

  it('falls back when the manifest hostname does not match the local host', async () => {
    await withHome(async () => {
      const slug = 'wrong-host';
      const paths = endpointPaths(slug);
      fs.mkdirSync(paths.dir, { recursive: true });
      fs.writeFileSync(paths.manifest, JSON.stringify({
        v: PROTOCOL_VERSION,
        pid: process.pid, // alive, so we'd otherwise attempt a connect
        socketPath: paths.socket,
        hostname: 'some-other-machine.example',
      }));

      const outcome = await tryProxy({
        slug,
        request: { v: PROTOCOL_VERSION, cmd: 'start-containers' },
      });
      expect(outcome.proxied).toBe(false);
      if (!outcome.proxied) {
        expect(outcome.reason).toMatch(/hostname/);
      }
    });
  });

  it('maps MenuBusyError thrown by the dispatcher to exit 75 (EX_TEMPFAIL)', async () => {
    await withHome(async () => {
      const slug = 'busy';
      const dispatch: ProxyDispatcher = async () => {
        throw new MenuBusyError('menu controller not ready');
      };
      const proxy = await startProxyServer({
        config: fakeConfig(slug),
        dispatch,
      });
      try {
        const outcome = await tryProxy({
          slug,
          request: { v: PROTOCOL_VERSION, cmd: 'build', noCache: false },
        });
        expect(outcome).toEqual({
          proxied: true,
          code: 75,
          error: 'menu controller not ready',
        });
      } finally {
        await proxy.close();
      }
    });
  });

  it('rejects clients with a different protocol version (exit code 2)', async () => {
    await withHome(async () => {
      const slug = 'version-mismatch';
      const dispatch: ProxyDispatcher = async () => { /* not reached */ };
      const proxy = await startProxyServer({
        config: fakeConfig(slug),
        dispatch,
      });
      try {
        // Hand-write a request with a bogus version; the client API doesn't
        // accept that, so cast through `any` to bypass the type. With the
        // unified terminal frame the server reports the mismatch as exit
        // code 2 (`EXIT_NEVER_DISPATCHED`). The wire layer (`tryProxy`)
        // surfaces that verbatim as `proxied: true, code: 2`; the
        // application-layer wrapper `proxyOrRun` then falls back to local
        // execution on code 2 (see protocol.ts docstring + program.ts) so a
        // newer-client-vs-older-server skew doesn't hard-fail what could
        // have run locally. This test asserts the wire layer only.
        const outcome = await tryProxy({
          slug,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request: { v: 999 as any, cmd: 'start-containers' },
        });
        expect(outcome.proxied).toBe(true);
        if (outcome.proxied) {
          expect(outcome.code).toBe(2);
          expect(outcome.error).toMatch(/protocol/i);
        }
      } finally {
        await proxy.close();
      }
    });
  });
});
