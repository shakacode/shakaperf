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
import { createInitCommand } from '../init';

jest.mock('node:module', () => ({ createRequire: jest.fn() }));

describe('init config scaffolding', () => {
  let project: string;
  let installedVersion: string | null;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  const template = path.resolve(__dirname, '../../../../templates/abtests.config.ts');

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-init-'));
    installedVersion = '0.3.0';
    const requiredPackage = path.join(project, 'required-shared.json');
    const installedPackage = path.join(project, 'installed-shared.json');
    fs.writeFileSync(requiredPackage, JSON.stringify({ version: '0.3.0' }));
    fs.writeFileSync(installedPackage, JSON.stringify({ version: installedVersion }));
    jest.spyOn(process, 'cwd').mockReturnValue(project);
    (createRequire as jest.Mock).mockImplementation((anchor: string) => ({
      resolve: () => {
        if (anchor !== path.join(project, 'package.json')) return requiredPackage;
        if (installedVersion === null) throw new Error('Cannot resolve shaka-shared');
        fs.writeFileSync(installedPackage, JSON.stringify({ version: installedVersion }));
        return installedPackage;
      },
    }));
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(project, { recursive: true, force: true });
  });

  function run(...args: string[]): void {
    createInitCommand().parse(args, { from: 'user' });
  }

  it('copies only the config and prints the skills installation command', () => {
    run();
    expect(fs.readFileSync(path.join(project, 'abtests.config.ts'), 'utf8'))
      .toBe(fs.readFileSync(template, 'utf8'));
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.agents'))).toBe(false);
    expect(log.mock.calls.flat().join('\n'))
      .toContain('npx skills add shakacode/shakaperf --skill shaka-perf shaka-perf-add-coverage shaka-perf-coverage shaka-perf-dockerize shaka-perf-find-bugs --agent claude-code codex');
  });

  it.each(['nested/config.ts', '/absolute'])('supports --out %s', (destination) => {
    const out = destination === '/absolute' ? path.join(project, 'absolute.ts') : destination;
    run('--out', out);
    expect(fs.readFileSync(path.resolve(project, out), 'utf8'))
      .toBe(fs.readFileSync(template, 'utf8'));
    expect(fs.existsSync(path.join(project, 'abtests.config.ts'))).toBe(false);
  });

  it('refuses to overwrite a config without --force', () => {
    const config = path.join(project, 'abtests.config.ts');
    fs.writeFileSync(config, 'user config');
    expect(() => run()).toThrow('exit 1');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('refusing to overwrite'));
    expect(fs.readFileSync(config, 'utf8')).toBe('user config');
  });

  it.each([false, true])('leaves existing skills untouched with force=%s', (force) => {
    const skillFiles = ['.claude/skills/shaka-perf/local.txt', '.agents/skills/custom/SKILL.md'];
    for (const file of skillFiles) {
      const dest = path.join(project, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, `user content: ${file}`);
    }
    if (force) fs.writeFileSync(path.join(project, 'abtests.config.ts'), 'old config');
    run(...(force ? ['--force'] : []));
    expect(fs.readFileSync(path.join(project, 'abtests.config.ts'), 'utf8'))
      .toBe(fs.readFileSync(template, 'utf8'));
    for (const file of skillFiles) {
      expect(fs.readFileSync(path.join(project, file), 'utf8')).toBe(`user content: ${file}`);
    }
    expect(fs.readdirSync(path.join(project, '.claude/skills'))).toEqual(['shaka-perf']);
    expect(fs.readdirSync(path.join(project, '.agents/skills'))).toEqual(['custom']);
  });

  it.each([null, '0.2.0'])('fails before scaffolding when shaka-shared is %s', (version) => {
    installedVersion = version;
    expect(() => run()).toThrow('exit 1');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('shaka-shared'));
    expect(fs.existsSync(path.join(project, 'abtests.config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
  });
});
