import { spawn, execSync, SpawnOptions } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';

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

export interface ExecWithStdinOptions extends ExecOptions {
  stdin: string;
}

/**
 * Execute a command with stdin input (like a heredoc in bash).
 */
export function execWithStdin(
  command: string,
  args: string[],
  options: ExecWithStdinOptions
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    const child = spawn(command, args, spawnOptions);
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (!options.silent) {
          process.stdout.write(data);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (!options.silent) {
          process.stderr.write(data);
        }
      });
    }

    child.on('error', (error) => {
      resolve({ stdout, stderr: error.message, code: 1 });
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    // Write stdin and close
    if (child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

function getScriptsDir(): string {
  // From dist/helpers/shell.js -> ../../scripts/
  return path.resolve(__dirname, '..', '..', 'scripts');
}

/**
 * Run a bash function in parallel for both experiment and control servers
 * using GNU parallel with colored [EXPERIMENT]/[CONTROL] prefixes.
 *
 * The bashFn string should define and export a function, e.g.:
 *   `my_func() { docker build ...; }\nexport -f my_func`
 *
 * The function will be called with "experiment" and "control" as arguments.
 */
export async function runForBothServersInParallel(bashFn: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const match = bashFn.match(/^(\w+)\s*\(\)/m);
  if (!match) {
    throw new Error('Could not detect function name in bashFn. Expected "func_name() {" pattern.');
  }
  const functionName = match[1];

  requireCommand('parallel', '`brew install parallel` (Mac) or `sudo apt-get install parallel` (Ubuntu)');

  const helperScript = path.join(getScriptsDir(), 'run-for-both-servers-in-parallel.sh');
  const script = `${bashFn}
source '${helperScript}'
run_for_both_servers_in_parallel ${functionName}`;

  const result = await exec('bash', ['-c', script], { env });
  if (result.code !== 0) {
    throw new Error(`Parallel execution of ${functionName} failed`);
  }
}

export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}
