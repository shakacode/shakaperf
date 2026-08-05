/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findUnignoredShakaResultDirs,
  warnIfShakaResultsNotIgnored,
} from '../helpers/dockerignore';

describe('twin-server Docker ignore warnings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-dockerignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts result exclusions for a project inside a monorepo context', () => {
    const dockerfileDir = path.join(tmpDir, 'twin-servers');
    const dockerfile = path.join(dockerfileDir, 'Dockerfile');
    const dockerignore = `${dockerfile}.dockerignore`;
    const projectDir = path.join(tmpDir, 'apps', 'store');
    fs.mkdirSync(dockerfileDir, { recursive: true });
    fs.writeFileSync(
      dockerignore,
      '**/compare-bisect-results*/\n**/compare-results*/\n',
      'utf8',
    );

    expect(findUnignoredShakaResultDirs(
      tmpDir,
      dockerfile,
      projectDir,
    )).toEqual([]);
  });

  it('reports only result directories that the project has not excluded', () => {
    const dockerfile = path.join(tmpDir, 'Dockerfile');
    fs.writeFileSync(`${dockerfile}.dockerignore`, 'compare-results*/\n', 'utf8');

    expect(findUnignoredShakaResultDirs(
      tmpDir,
      dockerfile,
      tmpDir,
    )).toEqual(['compare-bisect-results/']);
  });

  it('warns with recommended rules without creating temporary files', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const dockerfile = path.join(tmpDir, 'Dockerfile');

    warnIfShakaResultsNotIgnored('experiment', tmpDir, dockerfile, tmpDir);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('experiment'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('**/compare-results*/'));
    expect(fs.readdirSync(tmpDir)).toEqual([]);
    warn.mockRestore();
  });
});
