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
    projectDir: '/project',
    controlDir: '/control',
    dockerBuildDir: '/build',
    dockerfile: 'Dockerfile',
    dockerBuildArgs: { KEY: 'value' },
    procfile: 'Procfile.twin',
    images: {
      control: 'myapp:control',
      experiment: 'myapp:experiment',
    },
    volumes: {
      control: '/tmp/control',
      experiment: '/tmp/experiment',
    },
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

  it('rejects empty projectDir', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      projectDir: '',
    });
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

  it('rejects missing images', () => {
    const { images, ...rest } = validConfig;
    const result = TwinServersConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty images.control', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      images: { control: '', experiment: 'myapp:experiment' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty images.experiment', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      images: { control: 'myapp:control', experiment: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing volumes', () => {
    const { volumes, ...rest } = validConfig;
    const result = TwinServersConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty volumes.control', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      volumes: { control: '', experiment: '/tmp/exp' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty volumes.experiment', () => {
    const result = TwinServersConfigSchema.safeParse({
      ...validConfig,
      volumes: { control: '/tmp/ctrl', experiment: '' },
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
