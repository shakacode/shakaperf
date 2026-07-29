/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface LogFrame {
  type: 'log';
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface ErrorFrame {
  type: 'error';
  message: string;
  stack: string;
  /**
   * Filename (under the worker's `resultsFolder`) of a media artifact the
   * worker captured at the failure — a screencast `.mp4` when frames were
   * recorded, else a screenshot `.png` of the final state. The parent rebuilds
   * the `Error` and reattaches this so cause-chain walkers downstream can pick
   * it up and surface a `StageFailureError`.
   */
  failureMediaName?: string;
  /**
   * Label of the last `annotate(...)` the test reached before throwing (e.g.
   * "Fill email"). The parent reattaches it to the rebuilt Error so central
   * log/report formatting can surface the in-flight test step. Forwarded the
   * same way as `failureMediaName`.
   */
  lastAnnotation?: string;
}

export type WorkerLogFrame = LogFrame | ErrorFrame;

// Captured before installWorkerLogForwarder runs so the fallback path can't
// loop back through any later hook.
type OriginalWrite = (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
const originalStdoutWrite = process.stdout.write.bind(process.stdout) as OriginalWrite;
const originalStderrWrite = process.stderr.write.bind(process.stderr) as OriginalWrite;
let installed = false;

function originalWriteFor(level: LogFrame['level']): OriginalWrite {
  return level === 'log' ? originalStdoutWrite : originalStderrWrite;
}

function writeOriginal(level: LogFrame['level'], text: string): void {
  try { originalWriteFor(level)(text); } catch { /* stdio closed */ }
}

function sendFrame(frame: WorkerLogFrame): boolean {
  if (!process.send) return false;
  try {
    process.send(frame);
    return true;
  } catch {
    return false;
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

function sendLogFrame(level: LogFrame['level'], message: string): boolean {
  return sendFrame({ type: 'log', level, message });
}

function normalizeChunk(chunk: unknown, encoding: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
  }
  return String(chunk);
}

function installStreamForwarder(
  stream: NodeJS.WriteStream,
  level: LogFrame['level'],
): () => void {
  let buffer = '';
  const flushLine = (line: string, lineTerminated: boolean): void => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (sendLogFrame(level, normalized)) return;
    writeOriginal(level, lineTerminated ? `${line}\n` : line);
  };

  stream.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const cb = typeof encodingOrCallback === 'function'
      ? encodingOrCallback
      : typeof callback === 'function'
        ? callback
        : undefined;
    buffer += normalizeChunk(chunk, encoding);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) flushLine(line, true);
    cb?.();
    return true;
  }) as typeof stream.write;

  return () => {
    if (buffer.length === 0) return;
    const tail = buffer;
    buffer = '';
    flushLine(tail, false);
  };
}

/**
 * Fatal-error path. IPC is preferred so the parent's OOPLighthouseSampler can
 * rebuild the Error and re-throw. If IPC is dead (parent crashed, channel
 * closed mid-teardown) we fall back to the worker's original stderr — `inherit`
 * carries those bytes to the parent terminal so the stack still surfaces.
 */
export function sendErrorFrame(frame: ErrorFrame): void {
  if (sendFrame(frame)) return;
  writeOriginal('error', JSON.stringify(frame) + '\n');
}

export function installWorkerLogForwarder(): void {
  if (installed) return;
  installed = true;
  const flushStdout = installStreamForwarder(process.stdout, 'log');
  const flushStderr = installStreamForwarder(process.stderr, 'error');
  process.once('beforeExit', () => {
    flushStdout();
    flushStderr();
  });
  process.once('exit', () => {
    flushStdout();
    flushStderr();
  });

  const sendLog = (level: LogFrame['level'], message: string): void => {
    if (sendLogFrame(level, message)) return;
    writeOriginal(level, message + '\n');
  };
  console.log = (...args: unknown[]) => sendLog('log', formatConsoleArgs(args));
  console.info = (...args: unknown[]) => sendLog('log', formatConsoleArgs(args));
  console.debug = (...args: unknown[]) => sendLog('log', formatConsoleArgs(args));
  console.warn = (...args: unknown[]) => sendLog('warn', formatConsoleArgs(args));
  console.error = (...args: unknown[]) => sendLog('error', formatConsoleArgs(args));
}
