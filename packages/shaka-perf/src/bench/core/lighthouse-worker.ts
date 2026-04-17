import { loadTestFile, getRegisteredTests } from 'shaka-shared';
import type { BenchmarkSampler } from './run';
import type { NavigationSample } from './lighthouse-config';
import createLighthouseBenchmarkInProcess from './create-lighthouse-benchmark-in-process';

interface SetupMessage {
  type: 'setup';
  testFile: string;
  testName: string;
  baseUrl: string;
  group: string;
  options: Record<string, unknown>;
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
  process.send!(msg);
}

// Self-terminate if parent disconnects to prevent orphaned Chrome processes
process.on('disconnect', () => process.exit(1));

let sampler: BenchmarkSampler<NavigationSample>;

process.on('message', async (msg: ParentMessage) => {
  if (msg.type === 'setup') {
    try {
      await loadTestFile(msg.testFile);
      const tests = getRegisteredTests();
      const testDef = tests.find((t) => t.name === msg.testName);
      if (!testDef) {
        send({ type: 'error', message: `Test "${msg.testName}" not found in ${msg.testFile}`, stack: '' });
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
      send({ type: 'error', message: error.message, stack: error.stack ?? '' });
      process.exit(1);
    }
  } else if (msg.type === 'sample') {
    try {
      const sample = await sampler.sample(msg.iteration, msg.isTrial, undefined as any);
      send({ type: 'result', sample });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      send({ type: 'error', message: error.message, stack: error.stack ?? '' });
    }
  } else if (msg.type === 'dispose') {
    await sampler.dispose();
    process.exit(0);
  }
});
