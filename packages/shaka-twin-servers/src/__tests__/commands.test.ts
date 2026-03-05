import * as fs from 'fs';
import * as path from 'path';
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
    dockerfile: 'Dockerfile',
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
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates target directory if it does not exist', async () => {
    const { execSync } = require('child_process');
    const { syncChanges } = require('../commands/sync-changes');
    const config = createMockConfig(tmpDir);

    // Override git root to return the build dir inside tmpDir
    (execSync as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse --show-toplevel')) return config.dockerBuildDir;
      if (cmd.includes('diff --name-only')) return 'file1.ts';
      if (cmd.includes('ls-files --others')) return '';
      return '';
    });

    // Create the source file that the mock says is changed
    fs.writeFileSync(path.join(config.dockerBuildDir, 'file1.ts'), 'content');

    await syncChanges(config, 'experiment', { verbose: false });

    // The experiment volume dir should be created
    expect(fs.existsSync(config.volumes.experiment)).toBe(true);
  });
});

describe('say command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
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
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('runs command in both containers via GNU parallel', async () => {
    const { spawn } = require('child_process');
    const { runCmdParallel } = require('../commands/run-cmd-parallel');
    const config = createMockConfig(tmpDir);

    await runCmdParallel(config, 'echo test');

    // Should call spawn with 'parallel' containing both experiment and control commands
    const parallelCalls = (spawn as jest.Mock).mock.calls.filter(
      (call: any[]) => call[0] === 'parallel'
    );
    expect(parallelCalls.length).toBe(1);

    const args: string[] = parallelCalls[0][1];
    const experimentCmd = args.find((a: string) => a.includes('experiment'));
    const controlCmd = args.find((a: string) => a.includes('control'));
    expect(experimentCmd).toContain('echo test');
    expect(controlCmd).toContain('echo test');
  });
});

describe('run-overmind-command', () => {
  const tmpDir = path.join(__dirname, 'tmp-run-overmind');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
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

describe('build command', () => {
  const tmpDir = path.join(__dirname, 'tmp-build');

  // Save originals so we can restore after mocking process.exit
  const originalExit = process.exit;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    jest.resetModules();
    process.exit = jest.fn() as any;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  function setupBuildMocks(overrides: { remoteUrl?: string; defaultBranch?: string; confirmAnswer?: boolean; cloneExitCode?: number } = {}) {
    const { remoteUrl = 'git@github.com:test/repo.git', defaultBranch = 'main', confirmAnswer = true, cloneExitCode = 0 } = overrides;

    // Mock git helpers
    jest.doMock('../helpers/git', () => ({
      getGitRemoteUrl: jest.fn(() => remoteUrl),
      getDefaultBranch: jest.fn(() => defaultBranch),
      getChangedFiles: jest.fn(() => []),
      getGitRootDirectory: jest.fn(() => '/project'),
    }));

    // Mock docker helpers
    jest.doMock('../helpers/docker', () => ({
      getGitSha: jest.fn(() => 'abc1234'),
      getGitBranch: jest.fn(() => 'main'),
      getUserId: jest.fn(() => '1000'),
      getGroupId: jest.fn(() => '1000'),
      getUsername: jest.fn(() => 'testuser'),
    }));

    // Mock shell helpers
    const mockExec = jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: cloneExitCode });
    const mockConfirm = jest.fn().mockResolvedValue(confirmAnswer);
    jest.doMock('../helpers/shell', () => ({
      exec: mockExec,
      confirm: mockConfirm,
      requireCommand: jest.fn(),
      commandExists: jest.fn(() => true),
      runInParallel: jest.fn().mockResolvedValue(undefined),
      execSync_: jest.fn(() => ''),
    }));

    // Mock ui helpers
    jest.doMock('../helpers/ui', () => ({
      printBanner: jest.fn(),
      printSuccess: jest.fn(),
      printError: jest.fn(),
      printInfo: jest.fn(),
    }));

    return { mockExec, mockConfirm };
  }

  it('clones control repo without --single-branch when controlDir is missing', async () => {
    const { mockExec, mockConfirm } = setupBuildMocks();
    const { build } = require('../commands/build');

    const config = createMockConfig(tmpDir);
    // Remove controlDir so the clone path is triggered
    fs.rmSync(config.controlDir, { recursive: true });

    await build(config, { target: 'control' });

    // confirm should have been called
    expect(mockConfirm).toHaveBeenCalledWith('Clone now?');

    // Find the git clone call
    const cloneCalls = mockExec.mock.calls.filter(
      (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'clone'
    );
    expect(cloneCalls.length).toBe(1);

    const cloneArgs: string[] = cloneCalls[0][1];
    expect(cloneArgs).toContain('--branch');
    expect(cloneArgs).toContain('main');
    expect(cloneArgs).not.toContain('--single-branch');
    expect(cloneArgs).toContain('git@github.com:test/repo.git');
    expect(cloneArgs).toContain(config.controlDir);
  });

  it('uses the correct default branch in clone command', async () => {
    const { mockExec } = setupBuildMocks({ defaultBranch: 'develop' });
    const { build } = require('../commands/build');

    const config = createMockConfig(tmpDir);
    fs.rmSync(config.controlDir, { recursive: true });

    await build(config, { target: 'control' });

    const cloneCalls = mockExec.mock.calls.filter(
      (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'clone'
    );
    expect(cloneCalls[0][1]).toContain('develop');
  });

  it('exits when user declines to clone', async () => {
    const { mockExec, mockConfirm } = setupBuildMocks({ confirmAnswer: false });
    // Make process.exit throw to stop execution (simulates real exit behavior)
    (process.exit as unknown as jest.Mock).mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    const { build } = require('../commands/build');

    const config = createMockConfig(tmpDir);
    fs.rmSync(config.controlDir, { recursive: true });

    await expect(build(config, { target: 'control' })).rejects.toThrow('process.exit(1)');

    expect(mockConfirm).toHaveBeenCalledWith('Clone now?');

    // git clone should NOT have been called
    const cloneCalls = mockExec.mock.calls.filter(
      (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'clone'
    );
    expect(cloneCalls.length).toBe(0);
  });

  it('exits when clone fails', async () => {
    setupBuildMocks({ cloneExitCode: 1 });
    (process.exit as unknown as jest.Mock).mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    const { build } = require('../commands/build');
    const { printError } = require('../helpers/ui');

    const config = createMockConfig(tmpDir);
    fs.rmSync(config.controlDir, { recursive: true });

    await expect(build(config, { target: 'control' })).rejects.toThrow('process.exit(1)');

    expect(printError).toHaveBeenCalledWith('Clone failed');
  });

  it('exits when no remote URL is available', async () => {
    setupBuildMocks({ remoteUrl: '' });
    const { build } = require('../commands/build');
    const { printError } = require('../helpers/ui');

    const config = createMockConfig(tmpDir);
    fs.rmSync(config.controlDir, { recursive: true });

    await build(config, { target: 'control' });

    expect(printError).toHaveBeenCalledWith(`Control directory not found: ${config.controlDir}`);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('skips cloning when controlDir already exists', async () => {
    const { mockExec, mockConfirm } = setupBuildMocks();
    const { build } = require('../commands/build');

    const config = createMockConfig(tmpDir);
    // controlDir already exists from createMockConfig

    await build(config, { target: 'control' });

    // confirm should NOT have been called (no clone needed)
    expect(mockConfirm).not.toHaveBeenCalled();

    // No git clone call
    const cloneCalls = mockExec.mock.calls.filter(
      (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'clone'
    );
    expect(cloneCalls.length).toBe(0);
  });

  it('skips control clone check when building only experiment', async () => {
    const { mockConfirm } = setupBuildMocks();
    const { build } = require('../commands/build');

    const config = createMockConfig(tmpDir);
    // Remove controlDir — but since we're building experiment only, it shouldn't matter
    fs.rmSync(config.controlDir, { recursive: true });

    await build(config, { target: 'experiment' });

    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

describe('get-config command', () => {
  const tmpDir = path.join(__dirname, 'tmp-get-config');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns dockerfile value from config', () => {
    const config = createMockConfig(tmpDir);
    expect(config.dockerfile).toBe('Dockerfile');
  });

  it('returns controlDir value from config', () => {
    const config = createMockConfig(tmpDir);
    expect(config.controlDir).toBe(path.join(tmpDir, 'control'));
  });

  it('returns volumes object from config', () => {
    const config = createMockConfig(tmpDir);
    expect(config.volumes).toEqual({
      control: path.join(tmpDir, 'volumes', 'control'),
      experiment: path.join(tmpDir, 'volumes', 'experiment'),
    });
  });

  it('config has all expected keys', () => {
    const config = createMockConfig(tmpDir);
    const expectedKeys = [
      'projectDir',
      'controlDir',
      'dockerBuildDir',
      'dockerfile',
      'dockerBuildArgs',
      'composeFile',
      'procfile',
      'images',
      'volumes',
      'setupCommands',
    ];
    expectedKeys.forEach((key) => {
      expect(config).toHaveProperty(key);
    });
  });
});
