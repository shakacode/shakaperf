/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { stopContainers } from '../commands/stop-containers';
import { dockerComposeDown, dockerComposeRunningServices } from '../helpers/docker';
import { printSuccess } from '../helpers/ui';

jest.mock('../helpers/docker', () => ({
  dockerComposeDown: jest.fn().mockResolvedValue(undefined),
  dockerComposeRunningServices: jest.fn(),
}));

jest.mock('../helpers/ui', () => ({
  printBanner: jest.fn(),
  printSuccess: jest.fn(),
}));

const config = {} as ResolvedConfig;
const mockDockerComposeDown = dockerComposeDown as jest.MockedFunction<typeof dockerComposeDown>;
const mockDockerComposeRunningServices = dockerComposeRunningServices as jest.MockedFunction<typeof dockerComposeRunningServices>;
const mockPrintSuccess = printSuccess as jest.MockedFunction<typeof printSuccess>;

describe('stopContainers', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('does not say containers stopped when none were running', async () => {
    mockDockerComposeRunningServices.mockResolvedValue(new Set());

    await stopContainers(config);

    expect(logSpy).toHaveBeenCalledWith('No running containers found; removing volumes...');
    expect(mockDockerComposeDown).toHaveBeenCalledWith(config);
    expect(mockPrintSuccess).toHaveBeenCalledWith('No containers were running');
    expect(mockPrintSuccess).not.toHaveBeenCalledWith('Containers stopped');
  });

  it('says containers stopped when at least one service was running', async () => {
    mockDockerComposeRunningServices.mockResolvedValue(new Set(['control-server']));

    await stopContainers(config);

    expect(logSpy).toHaveBeenCalledWith('Stopping containers and removing volumes...');
    expect(mockDockerComposeDown).toHaveBeenCalledWith(config);
    expect(mockPrintSuccess).toHaveBeenCalledWith('Containers stopped');
  });
});
