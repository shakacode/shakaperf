/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';
import { getFfmpegSyncOption } from '../ffmpeg-sync-option';

let mockVersion = '';
let mockError: Error | null = null;
jest.mock('node:child_process', () => ({
  execFile: jest.fn((_file, _args, _options, callback) => callback(mockError, mockVersion)),
}));

afterEach(() => {
  mockError = null;
  jest.clearAllMocks();
});

it.each([
  ['4.4.2-0ubuntu0.22.04.1', '-vsync'],
  ['5.1.8', '-vsync'],
  ['6.0', '-fps_mode'],
  ['7.1.5', '-fps_mode'],
  ['9.0.2', '-fps_mode'],
  ['n6.1.1', '-fps_mode'],
  ['10.0-full_build', '-fps_mode'],
])('selects the sync option for FFmpeg %s', async (release, option) => {
  mockVersion = `ffmpeg version ${release} Copyright (c) FFmpeg developers\nconfiguration: ...`;
  await expect(getFfmpegSyncOption()).resolves.toBe(option);
  expect(execFile).toHaveBeenCalledWith('ffmpeg', ['-version'],
    expect.objectContaining({ timeout: 5000 }), expect.any(Function));
});

it('reports unparseable development versions instead of guessing an incompatible flag', async () => {
  mockVersion = 'ffmpeg version N-123456-gabcdef';
  await expect(getFfmpegSyncOption()).rejects.toThrow('cannot determine FFmpeg major version');
});

it.each(['ENOENT', 'ETIMEDOUT'])('preserves the %s detection failure', async (code) => {
  mockError = Object.assign(new Error('version probe failed'), { code });
  await expect(getFfmpegSyncOption()).rejects.toBe(mockError);
});
