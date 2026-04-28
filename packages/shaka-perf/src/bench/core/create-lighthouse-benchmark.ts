import { fork, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { RaceCancellation } from 'race-cancellation';

import { Benchmark, BenchmarkSampler } from './run';
import type { LighthouseBenchmarkOptions, NavigationSample } from './lighthouse-config';
import type { AbTestDefinition } from './ab-test-registry';

interface ResultMessage {
  type: 'result';
  sample: NavigationSample;
}

interface ErrorMessage {
  type: 'error';
  message: string;
  stack: string;
}

interface ReadyMessage {
  type: 'ready';
}

type WorkerMessage = ResultMessage | ErrorMessage | ReadyMessage;

function waitForMessage(worker: ChildProcess): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: WorkerMessage) => {
      cleanup();
      resolve(msg);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker exited unexpectedly with code ${code}`));
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.on('exit', onExit);
  });
}

function isWorkerAlive(worker: ChildProcess): boolean {
  return worker.connected && worker.exitCode === null && worker.signalCode === null;
}

/**
 * Split a piped child stdio stream into prefixed lines and tee each line to
 * every provided sink. Line-buffered so the prefix always attaches to the
 * start of a line (chunk boundaries are arbitrary). Any residual bytes after
 * the last newline are flushed with the prefix on stream end.
 */
function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );
}

function teeLinePrefixed(
  src: Readable,
  group: string,
  terminal: Writable,
  logStream: Writable,
): void {
  let buf = '';
  const prefix = `[${group}] `;
  src.setEncoding('utf8');
  src.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      terminal.write(`${prefix}${line}\n`);
      logStream.write(stripAnsi(`${prefix}${line}\n`));
    }
  });
  src.on('end', () => {
    if (buf.length > 0) {
      terminal.write(`${prefix}${buf}`);
      logStream.write(stripAnsi(`${prefix}${buf}`));
      buf = '';
    }
  });
}

function workerEnvWithColors(): NodeJS.ProcessEnv {
  if (process.env.NO_COLOR || process.env.FORCE_COLOR) return process.env;
  return { ...process.env, FORCE_COLOR: '1' };
}

function safeSend(worker: ChildProcess, msg: object): boolean {
  if (!isWorkerAlive(worker)) return false;
  try {
    return worker.send(msg);
  } catch {
    return false;
  }
}

class OOPLighthouseSampler implements BenchmarkSampler<NavigationSample> {
  constructor(
    private worker: ChildProcess,
    private logStream: WriteStream | null,
  ) {}

  async sample(
    iteration: number,
    isTrial: boolean,
    _raceCancellation: RaceCancellation
  ): Promise<NavigationSample> {
    if (!safeSend(this.worker, { type: 'sample', iteration, isTrial })) {
      throw new Error('lighthouse worker died before it could sample');
    }
    const msg = await waitForMessage(this.worker);
    if (msg.type === 'error') {
      const err = new Error(msg.message);
      err.stack = msg.stack;
      throw err;
    }
    return (msg as ResultMessage).sample;
  }

  async dispose(): Promise<void> {
    try {
      if (!isWorkerAlive(this.worker)) {
        if (!this.worker.killed && this.worker.exitCode === null) {
          this.worker.kill('SIGTERM');
        }
        return;
      }
      const sent = safeSend(this.worker, { type: 'dispose' });
      if (!sent) {
        if (!this.worker.killed) this.worker.kill('SIGTERM');
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!this.worker.killed) this.worker.kill('SIGTERM');
          resolve();
        }, 5000);
        this.worker.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      this.logStream?.end();
    }
  }
}

export default function createLighthouseBenchmark(
  group: string,
  baseUrl: string,
  testDef: AbTestDefinition,
  options: LighthouseBenchmarkOptions
): Benchmark<NavigationSample> {
  return {
    group,
    async setup(_raceCancellation) {
      const workerPath = join(__dirname, 'lighthouse-worker.js');
      // When logFile is set we pipe stdio and tee to a file; otherwise inherit
      // so the original terminal experience (colors, interleave) is preserved.
      // fork() auto-adds the IPC channel when stdio is 'inherit'; with a
      // custom array we must include 'ipc' explicitly.
      const logFile = options.logFile;
      const worker = logFile
        ? fork(workerPath, [], {
          stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
          env: workerEnvWithColors(),
        })
        : fork(workerPath, [], { stdio: 'inherit' });

      let logStream: WriteStream | null = null;
      if (logFile && worker.stdout && worker.stderr) {
        logStream = createWriteStream(logFile, { flags: 'a' });
        teeLinePrefixed(worker.stdout, group, process.stdout, logStream);
        teeLinePrefixed(worker.stderr, group, process.stderr, logStream);
      }

      worker.on('error', (err) => {
        console.error(`[lighthouse worker ${group}] ${err.message}`);
      });
      worker.on('exit', () => {
        logStream?.end();
      });

      if (!safeSend(worker, {
        type: 'setup',
        testFile: testDef.file,
        testName: testDef.name,
        baseUrl,
        group,
        options,
      })) {
        logStream?.end();
        throw new Error('lighthouse worker died before setup could be sent');
      }

      const ready = await waitForMessage(worker);
      if (ready.type === 'error') {
        logStream?.end();
        throw new Error((ready as ErrorMessage).message);
      }

      return new OOPLighthouseSampler(worker, logStream);
    }
  };
}
