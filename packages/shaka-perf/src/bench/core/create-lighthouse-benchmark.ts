import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
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

class OOPLighthouseSampler implements BenchmarkSampler<NavigationSample> {
  constructor(private worker: ChildProcess) {}

  async sample(
    iteration: number,
    isTrial: boolean,
    _raceCancellation: RaceCancellation
  ): Promise<NavigationSample> {
    this.worker.send({ type: 'sample', iteration, isTrial });
    const msg = await waitForMessage(this.worker);
    if (msg.type === 'error') {
      const err = new Error(msg.message);
      err.stack = msg.stack;
      throw err;
    }
    return (msg as ResultMessage).sample;
  }

  async dispose(): Promise<void> {
    this.worker.send({ type: 'dispose' });
    await new Promise<void>((resolve) => {
      this.worker.on('exit', () => resolve());
      setTimeout(() => {
        if (!this.worker.killed) this.worker.kill('SIGTERM');
        resolve();
      }, 5000);
    });
  }
}

export default function createLighthouseBenchmark(
  group: string,
  baseUrl: string,
  testDef: AbTestDefinition,
  options: Partial<LighthouseBenchmarkOptions> = {}
): Benchmark<NavigationSample> {
  return {
    group,
    async setup(_raceCancellation) {
      const workerPath = join(__dirname, 'lighthouse-worker.js');
      const worker = fork(workerPath, [], { stdio: 'inherit' });

      worker.send({
        type: 'setup',
        testFile: testDef.file,
        testName: testDef.name,
        baseUrl,
        group,
        options,
      });

      const ready = await waitForMessage(worker);
      if (ready.type === 'error') {
        throw new Error((ready as ErrorMessage).message);
      }

      return new OOPLighthouseSampler(worker);
    }
  };
}
