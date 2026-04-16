import os from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const TOTAL_CORES = os.cpus().length;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 5000;

// Always-busy distribution: alternate between all cores at 100% and a random
// subset at 100%. Never idle — the system is always under load so the
// HighNoise regime is genuinely stressful.
const P_ALL = 0.5; // probability of all cores busy; otherwise random 1..N-1

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickBusyCoreCount(): number {
  if (Math.random() < P_ALL) return TOTAL_CORES;
  return randInt(1, Math.max(1, TOTAL_CORES - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWorker(): Promise<void> {
  let stop = false;
  parentPort!.on('message', (msg) => {
    if (msg === 'stop') stop = true;
  });
  let sink = 0;
  while (!stop) {
    // 100% duty cycle: no sleep, pure busy loop. Yield periodically to let
    // the `stop` message land.
    const until = performance.now() + 50;
    while (performance.now() < until) {
      sink += Math.sqrt(Math.random() * 1e9);
    }
    if (sink === Number.POSITIVE_INFINITY) console.log(sink);
    await sleep(0);
  }
}

async function runMain(): Promise<void> {
  let workers: Worker[] = [];
  let shuttingDown = false;

  const spawnWave = (numCores: number): void => {
    for (const w of workers) {
      w.postMessage('stop');
      void w.terminate();
    }
    workers = [];
    for (let i = 0; i < numCores; i++) {
      const w = new Worker(__filename);
      w.on('error', () => {});
      workers.push(w);
    }
  };

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[noise] shutting down');
    for (const w of workers) {
      try {
        w.postMessage('stop');
      } catch {}
      void w.terminate();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[noise] total cores: ${TOTAL_CORES}`);
  while (!shuttingDown) {
    const numCores = pickBusyCoreCount();
    const durationMs = randInt(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    console.log(
      `[noise] ${numCores}/${TOTAL_CORES} cores @ 100% for ${(durationMs / 1000).toFixed(1)}s`,
    );
    spawnWave(numCores);
    await sleep(durationMs);
  }
}

if (isMainThread) {
  void runMain();
} else {
  void runWorker();
}
