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
import {
  CDP_SESSION_FILENAME,
  allocateCdpPorts,
  cdpEndpoint,
  describeCdpBrowsers,
  perfCdpSlot,
  withCdpPort,
  writeCdpSessionFile,
  type CdpSession,
} from '../debug-session';

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

describe('allocateCdpPorts', () => {
  it('hands each browser its own port, counting up from the base', async () => {
    const ports = await allocateCdpPorts(['visreg', 'perf:control', 'perf:experiment'], 21_400);
    expect(ports).toEqual({
      visreg: 21_400,
      'perf:control': 21_401,
      'perf:experiment': 21_402,
    });
  });

  it('steps over a port already in use — usually a previous session still parked', async () => {
    const squatter = await listenOn(21_500);
    try {
      const ports = await allocateCdpPorts(['visreg', 'perf:control'], 21_500);
      expect(ports.visreg).toBe(21_501);
      expect(ports['perf:control']).toBe(21_502);
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }
  });

  it('allocates nothing for a run with no browsers to publish', async () => {
    expect(await allocateCdpPorts([], 21_600)).toEqual({});
  });
});

describe('withCdpPort', () => {
  it('adds the debug flag without dropping the launch args the config asked for', () => {
    expect(withCdpPort({ args: ['--no-sandbox'] }, 9222).args)
      .toEqual(['--no-sandbox', '--remote-debugging-port=9222']);
  });

  it('is a no-op without a port, so a normal run opens nothing', () => {
    const resolved = { args: ['--no-sandbox'] };
    expect(withCdpPort(resolved, undefined)).toBe(resolved);
  });
});

describe('describeCdpBrowsers', () => {
  it('describes only the browsers that will actually open', () => {
    const browsers = describeCdpBrowsers({ visreg: 9222 });
    expect(browsers).toHaveLength(1);
    expect(browsers[0].slot).toBe('visreg');
    expect(browsers[0].endpoint).toBe('http://127.0.0.1:9222');
  });

  it('gives each perf side its own endpoint, since each is its own Chrome', () => {
    const browsers = describeCdpBrowsers({ 'perf:control': 9223, 'perf:experiment': 9224 });
    expect(browsers.map((b) => b.endpoint)).toEqual([
      'http://127.0.0.1:9223',
      'http://127.0.0.1:9224',
    ]);
  });
});

describe('perfCdpSlot', () => {
  it('keeps the two perf sides on separate slots', () => {
    expect(perfCdpSlot('control')).toBe('perf:control');
    expect(perfCdpSlot('experiment')).toBe('perf:experiment');
  });
});

describe('cdpEndpoint', () => {
  it('binds to loopback — a debug port is unauthenticated remote control', () => {
    expect(cdpEndpoint(9222)).toBe('http://127.0.0.1:9222');
  });
});

describe('the published session', () => {
  const session: CdpSession = {
    pid: 4242,
    test: 'Cart',
    viewport: 'desktop',
    headless: true,
    controlURL: 'http://localhost:3040',
    experimentURL: 'http://localhost:3050',
    browsers: describeCdpBrowsers({ visreg: 9222, 'perf:control': 9223 }),
  };

  it('writes a manifest an agent can read the endpoints out of', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-session-'));
    try {
      const file = writeCdpSessionFile(dir, session);
      expect(path.basename(file)).toBe(CDP_SESSION_FILENAME);
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CdpSession;
      expect(parsed.browsers.map((b) => b.endpoint)).toEqual([
        'http://127.0.0.1:9222',
        'http://127.0.0.1:9223',
      ]);
      // Nothing deletes the manifest (the session ends by the process dying),
      // so the pid is how a reader tells a live session from a leftover file.
      expect(parsed.pid).toBe(4242);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});
