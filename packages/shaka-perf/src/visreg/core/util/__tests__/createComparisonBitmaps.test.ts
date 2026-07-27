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

jest.mock('../../../../config-loader', () => ({
  loadTests: jest.fn(),
}));
jest.mock('../convertAbTestToScenario', () => ({
  convertAbTestToScenario: jest.fn(),
}));
jest.mock('../runCompareScenario', () => ({
  playwright: jest.fn(),
}));
jest.mock('../runPlaywright', () => ({
  createPlaywrightBrowser: jest.fn(),
  disposePlaywrightBrowser: jest.fn(),
}));

import { loadTests } from '../../../../config-loader';
import createComparisonBitmaps from '../createComparisonBitmaps';
import { convertAbTestToScenario } from '../convertAbTestToScenario';
import * as runCompareScenario from '../runCompareScenario';
import {
  createPlaywrightBrowser,
  disposePlaywrightBrowser,
} from '../runPlaywright';
import type { RuntimeConfig } from '../../types';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-cleanup-'));
  jest.mocked(loadTests).mockResolvedValue([{} as never]);
  jest.mocked(convertAbTestToScenario).mockReturnValue({
    label: 'S',
    url: 'http://experiment/test',
    referenceUrl: 'http://control/test',
  } as never);
  jest.mocked(createPlaywrightBrowser).mockResolvedValue({} as never);
  jest.mocked(runCompareScenario.playwright).mockResolvedValue({
    testPairs: [],
  } as never);
  jest.mocked(disposePlaywrightBrowser).mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeConfig(): RuntimeConfig {
  return {
    args: {
      controlURL: 'http://control',
      experimentURL: 'http://experiment',
      _loadedVisregConfig: {
        viewports: [{ label: 'desktop', width: 1280, height: 720 }],
        playwrightOptions: {},
      },
    },
    tempCompareConfigFileName: path.join(root, 'compare.json'),
    mismatchThreshold: 0,
    compareRetries: 0,
    compareRetryDelay: 0,
    maxNumDiffPixels: 0,
  } as unknown as RuntimeConfig;
}

it('rejects with a disposal failure after a successful comparison', async () => {
  const disposeError = new Error('dispose failed');
  jest.mocked(disposePlaywrightBrowser).mockRejectedValue(disposeError);

  const result = createComparisonBitmaps(makeConfig());
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('comparison cleanup timed out')), 100);
  });

  await expect(Promise.race([result, timeout])).rejects.toBe(disposeError);
});

it('preserves the comparison failure when disposal also fails', async () => {
  const comparisonError = new Error('comparison failed');
  jest.mocked(runCompareScenario.playwright).mockRejectedValue(comparisonError);
  jest.mocked(disposePlaywrightBrowser).mockRejectedValue(
    new Error('dispose failed'),
  );

  await expect(createComparisonBitmaps(makeConfig())).rejects.toBe(
    comparisonError,
  );
});
