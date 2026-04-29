import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import chalk from 'chalk';

interface TestContext {
  testName: string;
  logSubject: string;
}

const storage = new AsyncLocalStorage<TestContext>();
const subjectColors = [
  chalk.cyan,
  chalk.green,
  chalk.magenta,
  chalk.yellow,
  chalk.blue,
  chalk.white,
] as const;
const subjectColorIndexes = new Map<string, number>();
const viewportColorIndexes = new Map<string, number>();
const sourcePrefixParts = new Map<string, { source: string; viewportLabel?: string }>();

function colorFor(map: Map<string, number>, key: string): (value: string) => string {
  let colorIndex = map.get(key);
  if (colorIndex == null) {
    colorIndex = map.size % subjectColors.length;
    map.set(key, colorIndex);
  }
  return subjectColors[colorIndex];
}

export function testSourcePrefix(
  file: string | null | undefined,
  line: number | null | undefined,
  fallback: string,
  viewportLabel?: string,
): string {
  const relativeFile = file ? path.relative(process.cwd(), file) : null;
  const base = relativeFile && line != null ? `${relativeFile}:${line}` : fallback;
  const prefix = viewportLabel ? `${base}:${viewportLabel}` : base;
  sourcePrefixParts.set(prefix, { source: base, viewportLabel });
  return prefix;
}

export function colorizedLogPrefix(subject: string): string {
  const parts = sourcePrefixParts.get(subject);
  if (parts) {
    const source = colorFor(subjectColorIndexes, parts.source)(parts.source);
    if (parts.viewportLabel) {
      const viewport = colorFor(viewportColorIndexes, parts.viewportLabel)(parts.viewportLabel);
      return `${source}:${viewport}:`;
    }
    return `${source}:`;
  }
  return colorFor(subjectColorIndexes, subject)(`${subject}:`);
}

export function runWithTestName<T> (
  testName: string,
  fn: () => Promise<T>,
  logSubject = testName,
): Promise<T> {
  return storage.run({ testName, logSubject }, fn);
}

export function getTestName (): string | undefined {
  return storage.getStore()?.testName;
}

export function getTestLogSubject (): string | undefined {
  return storage.getStore()?.logSubject;
}

let installed = false;

export function installTestNamePrefix () {
  if (installed) return;
  installed = true;

  const methods = ['log', 'warn', 'error', 'info'] as const;
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const subject = getTestLogSubject();
      if (subject) {
        original(colorizedLogPrefix(subject), ...args);
      } else {
        original(...args);
      }
    };
  }
}

export function registerTestNames (names: string[]) {
  for (const name of names) {
    colorizedLogPrefix(name);
  }
}
