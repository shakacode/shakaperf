import { loadTestFile, getRegisteredTests } from 'shaka-shared';
import type { BenchmarkSampler } from './run';
import type { LighthouseBenchmarkOptions, NavigationSample } from './lighthouse-config';
import createLighthouseBenchmarkInProcess from './create-lighthouse-benchmark-in-process';

interface SetupMessage {
  type: 'setup';
  testFile: string;
  testName: string;
  baseUrl: string;
  group: string;
  options: LighthouseBenchmarkOptions;
}

interface SampleMessage {
  type: 'sample';
  iteration: number;
  isTrial: boolean;
}

interface DisposeMessage {
  type: 'dispose';
}

type ParentMessage = SetupMessage | SampleMessage | DisposeMessage;

function send(msg: object): void {
  try {
    process.send!(msg);
  } catch {
    // Parent channel already closed — nothing we can do from here.
  }
}

// Error payloads go to stderr first (captured by the parent's teeLinePrefixed
// → engine-output.log → readPerfEngineLog → report error dialog) and only
// then to IPC. Stderr is the canonical channel: even if IPC is dead (parent
// crashed, channel closed mid-teardown) the stack survives on disk.
function sendError(msg: { type: 'error'; message: string; stack: string }): void {
  try { process.stderr.write(JSON.stringify(msg) + '\n'); } catch { /* stderr closed */ }
  send(msg);
}

// Self-terminate if parent disconnects to prevent orphaned Chrome processes
process.on('disconnect', () => process.exit(1));

// Async CDP / puppeteer failures during a sample can surface as unhandled
// rejections AFTER we've already returned a result or error for the current
// iteration. Without these, a late rejection crashes the worker with a bare
// stack trace on stderr — parent then hits ERR_IPC_CHANNEL_CLOSED on its next
// send and the whole pipeline dies. Report what we can and exit cleanly so the
// per-test try/catch upstream can record the failure and keep going.
function reportFatal(err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
  process.exit(1);
}
process.on('unhandledRejection', reportFatal);
process.on('uncaughtException', reportFatal);

let sampler: BenchmarkSampler<NavigationSample>;

process.on('message', async (msg: ParentMessage) => {
  if (msg.type === 'setup') {
    try {
      await loadTestFile(msg.testFile);
      const tests = getRegisteredTests();
      const testDef = tests.find((t) => t.name === msg.testName);
      if (!testDef) {
        sendError({ type: 'error', message: `Test "${msg.testName}" not found in ${msg.testFile}`, stack: '' });
        process.exit(1);
        return;
      }

      const benchmark = createLighthouseBenchmarkInProcess(
        msg.group,
        msg.baseUrl,
        testDef,
        msg.options
      );
      sampler = await benchmark.setup(undefined as any);
      send({ type: 'ready' });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
      process.exit(1);
    }
  } else if (msg.type === 'sample') {
    try {
      const sample = await sampler.sample(msg.iteration, msg.isTrial, undefined as any);
      send({ type: 'result', sample });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      sendError({ type: 'error', message: error.message, stack: error.stack ?? '' });
    }
  } else if (msg.type === 'dispose') {
    await sampler.dispose();
    process.exit(0);
  }
});
