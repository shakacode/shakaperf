import { spawn, execSync, SpawnOptions } from 'child_process';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  silent?: boolean;
}

export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.silent ? 'pipe' : 'inherit',
    };

    const child = spawn(command, args, spawnOptions);
    let stdout = '';
    let stderr = '';

    if (options.silent && child.stdout && child.stderr) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    child.on('error', (error) => {
      resolve({ stdout, stderr: error.message, code: 1 });
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export function execSync_(command: string, options: { cwd?: string; silent?: boolean } = {}): string {
  try {
    return execSync(command, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function requireCommand(command: string, installHint: string): void {
  if (!commandExists(command)) {
    throw new Error(`Required command '${command}' not found.\nInstall with: ${installHint}`);
  }
}
