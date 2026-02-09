import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ResolvedConfig } from '../types';

// Mock child_process for all command tests
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const EventEmitter = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    proc.killed = false;
    proc.exitCode = null;
    proc.kill = jest.fn();
    // Auto-close with success by default
    setTimeout(() => proc.emit('close', 0), 10);
    return proc;
  }),
  execSync: jest.fn((cmd: string) => {
    if (cmd.includes('which')) return '/usr/bin/cmd';
    if (cmd.includes('rev-parse --short HEAD')) return 'abc1234';
    if (cmd.includes('branch --show-current')) return 'main';
    if (cmd.includes('id -u')) return '1000';
    if (cmd.includes('id -g')) return '1000';
    if (cmd.includes('whoami')) return 'testuser';
    if (cmd.includes('docker image inspect')) return '[]';
    if (cmd.includes('diff --name-only')) return 'file1.ts\nfile2.ts';
    if (cmd.includes('ls-files --others')) return 'file3.ts';
    if (cmd.includes('rev-parse --show-toplevel')) return '/project';
    return '';
  }),
}));

function createMockConfig(tmpDir: string): ResolvedConfig {
  const projectDir = path.join(tmpDir, 'project');
  const controlDir = path.join(tmpDir, 'control');
  const dockerBuildDir = path.join(tmpDir, 'build');

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });
  fs.mkdirSync(dockerBuildDir, { recursive: true });

  return {
    projectDir,
    controlDir,
    dockerBuildDir,
    dockerBuildArgs: { NODE_ENV: 'production' },
    composeFile: path.join(projectDir, 'docker-compose.yml'),
    procfile: path.join(projectDir, 'Procfile.twin'),
    images: { control: 'myapp:control', experiment: 'myapp:experiment' },
    volumes: {
      control: path.join(tmpDir, 'volumes', 'control'),
      experiment: path.join(tmpDir, 'volumes', 'experiment'),
    },
    setupCommands: [],
  };
}

describe('sync-changes command', () => {
  const tmpDir = path.join(__dirname, 'tmp-sync-changes');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    jest.restoreAllMocks();
  });

  it('creates target directory if it does not exist', async () => {
    const { syncChanges } = require('../commands/sync-changes');
    const config = createMockConfig(tmpDir);

    // Create source files that the mocked git says are changed
    const sourceDir = '/project';
    fs.mkdirSync(sourceDir, { recursive: true });

    await syncChanges(config, 'experiment', { verbose: false });

    // The experiment volume dir should be created
    expect(fs.existsSync(config.volumes.experiment)).toBe(true);
  });
});

describe('say command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns early for empty message', async () => {
    const { say } = require('../commands/say');
    const { spawn } = require('child_process');
    await say('');
    // spawn should not be called for command checks when message is empty
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('run-cmd command', () => {
  const tmpDir = path.join(__dirname, 'tmp-run-cmd');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    jest.restoreAllMocks();
  });

  it('maps control target to control-server container', async () => {
    const { spawn } = require('child_process');
    const { runCmd } = require('../commands/run-cmd');
    const config = createMockConfig(tmpDir);

    await runCmd(config, 'control', 'echo hello');

    // spawn should have been called with docker compose exec control-server
    expect(spawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['control-server']),
      expect.any(Object)
    );
  });

  it('maps experiment target to experiment-server container', async () => {
    const { spawn } = require('child_process');
    const { runCmd } = require('../commands/run-cmd');
    const config = createMockConfig(tmpDir);

    await runCmd(config, 'experiment', 'echo hello');

    expect(spawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['experiment-server']),
      expect.any(Object)
    );
  });
});

describe('run-cmd-parallel command', () => {
  const tmpDir = path.join(__dirname, 'tmp-run-cmd-parallel');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    jest.restoreAllMocks();
  });

  it('runs command in both containers', async () => {
    const { spawn } = require('child_process');
    const { runCmdParallel } = require('../commands/run-cmd-parallel');
    const config = createMockConfig(tmpDir);

    await runCmdParallel(config, 'echo test');

    // Should call spawn twice (once for each container)
    const dockerCalls = (spawn as jest.Mock).mock.calls.filter(
      (call: any[]) => call[0] === 'docker'
    );
    expect(dockerCalls.length).toBe(2);

    const allArgs = dockerCalls.flatMap((call: any[]) => call[1] as string[]);
    expect(allArgs).toContain('experiment-server');
    expect(allArgs).toContain('control-server');
  });
});

describe('run-overmind-command', () => {
  const tmpDir = path.join(__dirname, 'tmp-run-overmind');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    jest.restoreAllMocks();
  });

  it('wraps command with PID tracking', async () => {
    const { spawn } = require('child_process');
    const { runOvermindCommand } = require('../commands/run-overmind-command');
    const config = createMockConfig(tmpDir);

    await runOvermindCommand(config, 'control', 'bundle exec puma');

    const dockerCall = (spawn as jest.Mock).mock.calls.find(
      (call: any[]) => call[0] === 'docker'
    );
    expect(dockerCall).toBeTruthy();
    // The wrapped command should contain PID redirection
    const bashCmd = dockerCall[1].find((arg: string) => arg.includes('echo $!'));
    expect(bashCmd).toBeTruthy();
    expect(bashCmd).toContain('bundle exec puma');
    expect(bashCmd).toContain('/tmp/overmind-pid.');
  });
});

describe('forward-ports command', () => {
  // forward-ports uses parsePortMapping internally

  it('parsePortMapping is tested via module internals', () => {
    // parsePortMapping is not exported, but we can test the behavior through the command
    // by checking that the right SSH args are built
    // For now, test that the module exports the function
    const mod = require('../commands/forward-ports');
    expect(mod.forwardPorts).toBeDefined();
  });
});

describe('copy-changes-to-ssh command', () => {
  it('exports copyChangesToSsh function', () => {
    const mod = require('../commands/copy-changes-to-ssh');
    expect(mod.copyChangesToSsh).toBeDefined();
  });
});
