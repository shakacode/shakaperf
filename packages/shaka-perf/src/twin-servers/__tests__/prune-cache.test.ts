/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { pruneBuildCache } from '../commands/prune-cache';
import * as shell from '../helpers/shell';
import type { ResolvedConfig } from '../types';

jest.mock('../helpers/shell');
jest.mock('../helpers/ui', () => ({
  printInfo: jest.fn(),
  printSuccess: jest.fn(),
}));

const mockExec = shell.exec as jest.MockedFunction<typeof shell.exec>;
const mockRequireCommand = shell.requireCommand as jest.MockedFunction<typeof shell.requireCommand>;

describe('pruneBuildCache', () => {
  const config = {
    projectSlug: 'code--shaka--shop',
    images: {
      control: 'shop:control',
      experiment: 'shop:experiment',
    },
  } as ResolvedConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prunes all cache from only the project builder', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Driver: docker-container\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'Total: 12GB', stderr: '', code: 0 });

    await pruneBuildCache(config);

    expect(mockRequireCommand).toHaveBeenCalledWith(
      'docker',
      'Install Docker from https://docs.docker.com/get-docker/',
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['buildx', 'inspect', '--bootstrap', 'shaka-perf-code--shaka--shop'],
      { silent: true },
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      3,
      'docker',
      ['buildx', 'prune', '--builder', 'shaka-perf-code--shaka--shop', '--all', '--force'],
    );
  });

  it('does nothing when the project builder does not exist', async () => {
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 1 });

    await pruneBuildCache(config);

    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('also removes existing control and experiment images when requested', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Driver: docker-container\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'Total: 12GB', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    await pruneBuildCache(config, { images: true });

    expect(mockExec).toHaveBeenNthCalledWith(
      4,
      'docker',
      ['image', 'inspect', 'shop:control'],
      { silent: true },
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      5,
      'docker',
      ['image', 'inspect', 'shop:experiment'],
      { silent: true },
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      6,
      'docker',
      ['image', 'rm', 'shop:control', 'shop:experiment'],
    );
  });

  it('removes images even when the project builder does not exist', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    await pruneBuildCache(config, { images: true });

    expect(mockExec).toHaveBeenLastCalledWith(
      'docker',
      ['image', 'rm', 'shop:control'],
    );
  });

  it('does not fail when the configured images are already absent', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 });

    await pruneBuildCache(config, { images: true });

    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it('explains how to release images referenced by containers', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'image is being used', code: 1 });

    await expect(pruneBuildCache(config, { images: true })).rejects.toThrow(
      /servers stop-containers/,
    );
  });

  it('refuses to prune a same-named global docker builder', async () => {
    mockExec.mockResolvedValue({ stdout: 'Driver: docker\n', stderr: '', code: 0 });

    await expect(pruneBuildCache(config)).rejects.toThrow(
      /must use the docker-container driver/,
    );
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('fails when the project builder prune fails', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Driver: docker-container\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'failed', code: 1 });

    await expect(pruneBuildCache(config)).rejects.toThrow(
      /Failed to prune Buildx cache for shaka-perf-code--shaka--shop/,
    );
  });
});
