/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';
import { measuredCommit } from '../run-metadata';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

const sha = 'a'.repeat(40);

describe('measured deployment identity', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.mocked(execFile).mockReset(); });

  it('leaves remote deployment identity unknown without HTTP or local Git guesses', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected HTTP identity lookup'));
    await expect(measuredCommit('https://deployed.test')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('reads Git inside the exact running container bound to the measured port', async () => {
    const outputs = ['container123\n', '{"3000/tcp":[{"HostPort":"3020","HostIp":"0.0.0.0"},{"HostPort":"3020","HostIp":"::"}]}\ncontrol-server\n', 'MISSING', `${sha}\0Title\n\nFull body\n`];
    jest.mocked(execFile).mockImplementation(((_file: string, _args: string[], _options: unknown, callback: (err: null, output: { stdout: string }) => void) => {
      callback(null, { stdout: outputs.shift()! });
    }) as never);
    await expect(measuredCommit('http://localhost:3020/cart')).resolves.toEqual({
      sha, message: 'Title\n\nFull body\n', source: 'Git in the running twin-server container',
    });
    expect(execFile).toHaveBeenLastCalledWith('docker', ['exec', 'container123', 'git', 'show', '-s', '--format=format:%H%x00%B', 'HEAD'], expect.anything(), expect.any(Function));
  });

  it.each([
    { url: 'http://127.0.0.1:3020', ports: { '3000/tcp': [{ HostPort: '3020', HostIp: '127.0.0.2' }] } },
    { url: 'http://127.0.0.1:3020', ports: { '3000/udp': [{ HostPort: '3020', HostIp: '0.0.0.0' }] } },
    { url: 'http://localhost:3020', ports: { '3000/tcp': [{ HostPort: '3020', HostIp: '127.0.0.1' }] } },
  ])('does not attribute a different socket binding to $url', async ({ url, ports }) => {
    const outputs = ['container123\n', `${JSON.stringify(ports)}\ncontrol-server\n`, `${sha}\0Wrong application`];
    jest.mocked(execFile).mockImplementation(((_file: string, _args: string[], _options: unknown, callback: (err: null, output: { stdout: string }) => void) => {
      callback(null, { stdout: outputs.shift()! });
    }) as never);
    await expect(measuredCommit(url)).resolves.toBeNull();
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
