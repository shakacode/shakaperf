import { exec, execSync_, commandExists, requireCommand, execWithStdin } from '../helpers/shell';
import { realpathSync } from 'fs';

describe('exec', () => {
  it('executes a command and returns stdout', async () => {
    const result = await exec('echo', ['hello'], { silent: true });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('returns non-zero code on failure', async () => {
    const result = await exec('bash', ['-c', 'exit 42'], { silent: true });
    expect(result.code).toBe(42);
  });

  it('captures stderr', async () => {
    const result = await exec('bash', ['-c', 'echo err >&2'], { silent: true });
    expect(result.stderr.trim()).toBe('err');
  });

  it('resolves with error code when command not found', async () => {
    const result = await exec('nonexistent_command_xyz', [], { silent: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toBeTruthy();
  });

  it('supports cwd option', async () => {
    const result = await exec('pwd', [], { cwd: '/tmp', silent: true });
    expect(result.stdout.trim()).toBe(realpathSync('/tmp'));
  });
});

describe('execSync_', () => {
  it('returns trimmed output', () => {
    const result = execSync_('echo "  hello  "');
    expect(result).toBe('hello');
  });

  it('returns empty string on error', () => {
    const result = execSync_('nonexistent_command_xyz 2>/dev/null');
    expect(result).toBe('');
  });

  it('supports cwd option', () => {
    const result = execSync_('pwd', { cwd: '/tmp' });
    expect(result).toBe(realpathSync('/tmp'));
  });
});

describe('commandExists', () => {
  it('returns true for existing commands', () => {
    expect(commandExists('echo')).toBe(true);
    expect(commandExists('bash')).toBe(true);
  });

  it('returns false for non-existing commands', () => {
    expect(commandExists('nonexistent_command_xyz')).toBe(false);
  });
});

describe('requireCommand', () => {
  it('does not throw for existing commands', () => {
    expect(() => requireCommand('echo', 'apt install echo')).not.toThrow();
  });

  it('throws with install hint for missing commands', () => {
    expect(() => requireCommand('nonexistent_command_xyz', 'brew install xyz'))
      .toThrow("Required command 'nonexistent_command_xyz' not found");
  });

  it('includes install hint in error message', () => {
    expect(() => requireCommand('nonexistent_command_xyz', 'brew install xyz'))
      .toThrow('brew install xyz');
  });
});

describe('execWithStdin', () => {
  it('passes stdin to the command', async () => {
    const result = await execWithStdin('bash', [], {
      stdin: 'echo "from stdin"',
      silent: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('from stdin');
  });

  it('supports multi-line stdin', async () => {
    const result = await execWithStdin('bash', [], {
      stdin: 'echo line1\necho line2',
      silent: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
  });

  it('returns non-zero code on failure', async () => {
    const result = await execWithStdin('bash', [], {
      stdin: 'exit 7',
      silent: true,
    });
    expect(result.code).toBe(7);
  });
});
