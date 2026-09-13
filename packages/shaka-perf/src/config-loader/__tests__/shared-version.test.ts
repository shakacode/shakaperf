/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { assertCompatibleSharedVersion } from '../shared-version';
import { loadTestFile } from '../load-test-file';
import { loadAbTestsConfig } from '../abtests-config';

// Jest substitutes its own resolver; supply the resolved package path here.
jest.mock('node:module', () => ({ ...jest.requireActual('node:module'), createRequire: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const required: string = require('../../../package.json').dependencies['shaka-shared'];

describe('assertCompatibleSharedVersion', () => {
  let tmp: string;
  let userFile: string;
  let sharedPackage: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-version-'));
    userFile = path.join(tmp, 'config.cjs');
    sharedPackage = path.join(tmp, 'package.json');
    (createRequire as jest.Mock).mockReturnValue({ resolve: () => sharedPackage });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses an exact dependency pin', () => {
    expect(required).toMatch(/^\d+\.\d+\.\d+(?:-.*)?$/);
  });

  it('rejects an older shared copy with upgrade instructions', () => {
    fs.writeFileSync(sharedPackage, JSON.stringify({ version: '0.0.0' }));
    expect(() => assertCompatibleSharedVersion(userFile)).toThrow(
      `Upgrade it: yarn add --exact shaka-shared@${required}`,
    );
    expect(createRequire).toHaveBeenCalledWith(userFile);
  });

  it.each([required, `${required}-rc.1`, '0.10.0', '99.0.0'])(
    'accepts a shared version meeting the minimum (%s)', (version) => {
      fs.writeFileSync(sharedPackage, JSON.stringify({ version }));
      expect(() => assertCompatibleSharedVersion(userFile)).not.toThrow();
    },
  );

  it('rejects a project with no shared package, with install instructions', () => {
    (createRequire as jest.Mock).mockReturnValue({
      resolve: () => { throw Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' }); },
    });
    expect(() => assertCompatibleSharedVersion(userFile)).toThrow(
      `shaka-shared is not installed for ${userFile}`,
    );
  });

  it('propagates resolution errors other than a missing package', () => {
    (createRequire as jest.Mock).mockReturnValue({ resolve: () => { throw new Error('EACCES'); } });
    expect(() => assertCompatibleSharedVersion(userFile)).toThrow('EACCES');
  });

  it('runs before user test files and configs are evaluated', async () => {
    fs.writeFileSync(sharedPackage, JSON.stringify({ version: '0.0.0' }));
    fs.writeFileSync(userFile, 'throw new Error("user code ran");');
    await expect(loadTestFile(userFile)).rejects.toThrow('Upgrade it:');
    await expect(loadAbTestsConfig(userFile)).rejects.toThrow('Upgrade it:');
  });
});
