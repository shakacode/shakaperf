import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { printWarning } from '../helpers/ui';

// File lock so concurrent `say` calls (e.g. control + experiment Procfile
// processes finishing dockerize-wait at roughly the same time) don't talk
// over each other. The lock is per-OS-user so two users on the same host
// don't block each other.
const LOCK_PATH = path.join(
  os.tmpdir(),
  `shaka-perf-say-${process.env.USER ?? process.env.USERNAME ?? 'shared'}.lock`,
);
const LOCK_RETRY_MS = 100;

function commandExists(command: string): Promise<boolean> {
  // `which` (coreutils on Linux, /usr/bin/which on macOS) avoids the
  // DEP0190 deprecation warning that fires when `shell: true` is combined
  // with array args.
  return new Promise((resolve) => {
    const proc = spawn('which', [command], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

interface SayBackend {
  cmd: string;
  argsFor: (message: string) => string[];
}

async function pickSayBackend(): Promise<SayBackend | null> {
  // macOS `say` blocks naturally until the audio finishes.
  if (await commandExists('say')) {
    return { cmd: 'say', argsFor: (m) => [m] };
  }
  // Linux `spd-say` returns immediately by default — it queues to the
  // speech-dispatcher daemon and exits — which would race the file lock and
  // let two announcements collapse into one. `-w` makes it block until the
  // utterance actually finishes.
  if (await commandExists('spd-say')) {
    return { cmd: 'spd-say', argsFor: (m) => ['-w', m] };
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(): Promise<void> {
  while (true) {
    try {
      const fd = fs.openSync(
        LOCK_PATH,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      );
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // The lock holder may have crashed before releasing — if its PID is
      // dead, take over the lock so we don't deadlock on a stale file.
      try {
        const holderPid = Number(fs.readFileSync(LOCK_PATH, 'utf8'));
        if (Number.isFinite(holderPid) && holderPid > 0 && !isProcessAlive(holderPid)) {
          fs.unlinkSync(LOCK_PATH);
          continue;
        }
      } catch {
        // The file was just removed by the holder — loop and retry.
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Already gone — fine.
  }
}

function runAndWait(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', () => resolve());
    proc.on('error', () => resolve());
  });
}

export async function say(message: string): Promise<void> {
  if (!message) return;

  const backend = await pickSayBackend();
  if (!backend) {
    printWarning("Neither 'say' nor 'spd-say' command found - skipping speech notification");
    return;
  }

  await acquireLock();
  try {
    await runAndWait(backend.cmd, backend.argsFor(message));
  } finally {
    releaseLock();
  }
}
