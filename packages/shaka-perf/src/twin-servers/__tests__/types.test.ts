/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { SetupCommandSchema, TwinServersConfigSchema } from '../types';

describe('SetupCommandSchema', () => {
  it('validates a valid setup command', () => {
    const result = SetupCommandSchema.safeParse({
      command: 'bundle exec rake db:migrate',
      description: 'Run database migrations',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty command', () => {
    const result = SetupCommandSchema.safeParse({
      command: '',
      description: 'desc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const result = SetupCommandSchema.safeParse({
      command: 'ls',
      description: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing command', () => {
    const result = SetupCommandSchema.safeParse({
      description: 'desc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = SetupCommandSchema.safeParse({
      command: 'ls',
    });
    expect(result.success).toBe(false);
  });
});

describe('TwinServersConfigSchema', () => {
  const validConfig = {
    experimentDir: '/project',
    controlDir: '/control',
    dockerBuildDir: '/build',
    dockerfile: 'Dockerfile',
    dockerBuildArgs: { KEY: 'value' },
    procfile: 'Procfile.twin',
    ports: { control: 3020, experiment: 3030 },
  };

  it('validates a complete valid config', () => {
    const result = TwinServersConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('accepts optional setupCommands', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      setupCommands: [
        { command: 'rake db:migrate', description: 'Migrate DB' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty experimentDir', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      experimentDir: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing experimentDir', () => {
    const { experimentDir: _omit, ...config } = validConfig;
    const result = TwinServersConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty controlDir', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      controlDir: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty dockerBuildDir', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      dockerBuildDir: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty dockerfile', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      dockerfile: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing composeFile (uses default)', () => {
    const result = TwinServersConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('accepts explicit composeFile', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      composeFile: 'docker-compose.yml',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty composeFile string', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      composeFile: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty procfile', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      procfile: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid setupCommands', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      setupCommands: [{ command: '', description: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows empty dockerBuildArgs', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      dockerBuildArgs: {},
    });
    expect(result.success).toBe(true);
  });

  it('allows multiple dockerBuildArgs', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      dockerBuildArgs: { FOO: 'bar', BAZ: 'qux' },
    });
    expect(result.success).toBe(true);
  });
});
