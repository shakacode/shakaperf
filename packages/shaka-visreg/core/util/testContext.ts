import { AsyncLocalStorage } from 'node:async_hooks';
import chalk from 'chalk';

interface TestContext {
  testName: string;
}

const storage = new AsyncLocalStorage<TestContext>();
let longestName = 0;

export function runWithTestName<T> (testName: string, fn: () => Promise<T>): Promise<T> {
  if (testName.length > longestName) {
    longestName = testName.length;
  }
  return storage.run({ testName }, fn);
}

export function getTestName (): string | undefined {
  return storage.getStore()?.testName;
}

let installed = false;

export function installTestNamePrefix () {
  if (installed) return;
  installed = true;

  const methods = ['log', 'warn', 'error', 'info'] as const;
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const name = getTestName();
      if (name) {
        const padded = name.padStart(longestName);
        original(chalk.yellow(padded) + ':', ...args);
      } else {
        original(...args);
      }
    };
  }
}

export function registerTestNames (names: string[]) {
  for (const name of names) {
    if (name.length > longestName) {
      longestName = name.length;
    }
  }
}
