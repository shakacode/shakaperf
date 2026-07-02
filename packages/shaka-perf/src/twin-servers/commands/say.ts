/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
// Import the lock module directly (not via the 'shaka-shared' barrel) so this
// leaf command pulls in only the fs-only file-lock, not the package's chalk /
// page-helper graph.
import { withFileLockAsync } from 'shaka-shared/dist/helpers/file-lock';
import { printWarning } from '../helpers/ui';

// File lock so concurrent `say` calls (e.g. control + experiment Procfile
// processes finishing dockerize-wait at roughly the same time) don't talk
// over each other. The lock is per-OS-user so two users on the same host
// don't block each other. The lock mechanism itself lives in shaka-shared's
// `withFileLockAsync`; we hold it across the (async) speech subprocess.
const LOCK_PATH = path.join(
  os.tmpdir(),
  `shaka-perf-say-${process.env.USER ?? process.env.USERNAME ?? 'shared'}.lock`,
);

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

  await withFileLockAsync(
    LOCK_PATH,
    () => runAndWait(backend.cmd, backend.argsFor(message)),
    {
      onLockTimeout: () =>
        printWarning(
          'Could not acquire say lock — speaking without serialization (announcements may overlap)',
        ),
    },
  );
}
