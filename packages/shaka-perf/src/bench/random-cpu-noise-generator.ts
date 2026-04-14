import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const TOTAL_CORES = os.cpus().length;
const MIN_INTERVAL_MS = 200;
const MAX_INTERVAL_MS = 1000;
const MIN_LOAD_PCT = 10;
const MAX_LOAD_PCT = 100;
const DUTY_CYCLE_MS = 100;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWorker(loadPct: number): Promise<void> {
  const busyMs = (loadPct / 100) * DUTY_CYCLE_MS;
  const idleMs = DUTY_CYCLE_MS - busyMs;
  let stop = false;
  parentPort!.on('message', (msg) => {
    if (msg === 'stop') stop = true;
  });
  let sink = 0;
  while (!stop) {
    const deadline = performance.now() + busyMs;
    while (performance.now() < deadline) {
      sink += Math.sqrt(Math.random() * 1e9);
    }
    if (sink === Number.POSITIVE_INFINITY) console.log(sink);
    await sleep(Math.max(0, idleMs));
  }
}

async function runMain(): Promise<void> {
  let workers: Worker[] = [];
  let shuttingDown = false;

  const spawnWave = (numCores: number, loadPct: number): void => {
    for (const w of workers) {
      w.postMessage('stop');
      void w.terminate();
    }
    workers = [];
    for (let i = 0; i < numCores; i++) {
      const w = new Worker(__filename, { workerData: { loadPct } });
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
    const numCores = randInt(1, TOTAL_CORES);
    const loadPct = randInt(MIN_LOAD_PCT, MAX_LOAD_PCT);
    const durationMs = randInt(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    console.log(
      `[noise] ${numCores}/${TOTAL_CORES} cores @ ${loadPct}% for ${(durationMs / 1000).toFixed(1)}s`,
    );
    spawnWave(numCores, loadPct);
    await sleep(durationMs);
  }
}

if (isMainThread) {
  void runMain();
} else {
  void runWorker((workerData as { loadPct: number }).loadPct);
}
