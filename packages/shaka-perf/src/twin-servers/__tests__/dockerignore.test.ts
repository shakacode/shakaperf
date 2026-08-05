/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ignore from 'ignore';
import {
  effectiveDockerignore,
  prepareDockerfileWithDefaults,
} from '../helpers/dockerignore';

describe('twin-server Docker ignore defaults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-dockerignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores compare output at the build root and inside monorepo projects', () => {
    const matcher = ignore().add(effectiveDockerignore(''));

    expect(matcher.ignores('compare-results/report.html')).toBe(true);
    expect(matcher.ignores('compare-results-old/report.html')).toBe(true);
    expect(matcher.ignores('compare-bisect-results/commits/a/result.json')).toBe(true);
    expect(matcher.ignores('apps/store/compare-results/report.html')).toBe(true);
    expect(matcher.ignores('apps/store/compare-bisect-results-retry/report.html')).toBe(true);
    expect(matcher.ignores('apps/store/src/index.ts')).toBe(false);
  });

  it('lets an explicit project negation override a default', () => {
    const matcher = ignore().add(effectiveDockerignore('!compare-results/'));

    expect(matcher.ignores('compare-results/')).toBe(false);
  });

  it('builds from a temporary Dockerfile pair without rewriting project files', () => {
    const dockerfileDir = path.join(tmpDir, 'twin-servers');
    const dockerfile = path.join(dockerfileDir, 'Dockerfile');
    const dockerignore = `${dockerfile}.dockerignore`;
    fs.mkdirSync(dockerfileDir, { recursive: true });
    fs.writeFileSync(dockerfile, 'FROM scratch\n', 'utf8');
    fs.writeFileSync(dockerignore, 'node_modules/\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.dockerignore'), 'root-only/\n', 'utf8');

    const prepared = prepareDockerfileWithDefaults(
      tmpDir,
      path.relative(tmpDir, dockerfile),
    );
    const preparedAbs = path.resolve(tmpDir, prepared.dockerfilePath);

    expect(fs.readFileSync(preparedAbs, 'utf8')).toBe('FROM scratch\n');
    const preparedIgnore = fs.readFileSync(`${preparedAbs}.dockerignore`, 'utf8');
    expect(preparedIgnore).toContain('compare-bisect-results*/');
    expect(preparedIgnore).toContain('compare-results*/');
    expect(preparedIgnore).toContain('node_modules/');
    expect(preparedIgnore).not.toContain('root-only/');
    expect(fs.readFileSync(dockerignore, 'utf8')).toBe('node_modules/\n');

    prepared.cleanup();
    expect(fs.existsSync(preparedAbs)).toBe(false);
    expect(fs.existsSync(`${preparedAbs}.dockerignore`)).toBe(false);
  });
});
