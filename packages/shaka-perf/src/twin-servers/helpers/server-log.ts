/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\x1B\x9B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const ERROR_PATTERN = /\b(error|fatal|exception|traceback|panic|failed|failure|segfault)\b/i;
const RUBY_ERROR_PATTERN = /\b[A-Z][A-Za-z0-9_:]*Error\b/;

export interface ServerLogLine {
  raw: string;
  text: string;
}

export interface ServerLogStatus {
  path: string;
  errorCount: number;
}

export class ServerLogStore {
  readonly path: string;
  private fd: number | null;
  private partialLine = '';
  private lines: ServerLogLine[] = [];
  private errors = 0;

  constructor(logPath: string, private readonly tailLimit = 2000) {
    this.path = logPath;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.fd = fs.openSync(logPath, 'w');
  }

  get errorCount(): number {
    return this.errors;
  }

  append(chunk: string): ServerLogLine[] {
    if (chunk.length === 0) return [];
    if (this.fd !== null) fs.writeSync(this.fd, chunk);

    const text = this.partialLine + chunk;
    const parts = text.split(/\r?\n/);
    this.partialLine = parts.pop() ?? '';
    const completed = parts.map((raw) => {
      const line = { raw, text: stripAnsi(raw) };
      if (isErrorLogLine(line.text)) this.errors++;
      return line;
    });

    if (completed.length > 0) {
      this.lines = this.lines.concat(completed);
      if (this.lines.length > this.tailLimit) {
        this.lines = this.lines.slice(-this.tailLimit);
      }
    }

    return completed;
  }

  tail(count: number): ServerLogLine[] {
    const tail = this.lines.slice(-count);
    if (this.partialLine.length === 0) return tail;
    return tail.concat({ raw: this.partialLine, text: stripAnsi(this.partialLine) }).slice(-count);
  }

  close(): void {
    if (this.fd === null) return;
    fs.closeSync(this.fd);
    this.fd = null;
  }
}

export function createServerLogStore(config: ResolvedConfig): ServerLogStore {
  return new ServerLogStore(serverLogPath(config));
}

export function serverLogPath(config: ResolvedConfig): string {
  return path.join(path.dirname(config.volumes.control), 'twin-servers.log');
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function isErrorLogLine(line: string): boolean {
  return ERROR_PATTERN.test(line) || RUBY_ERROR_PATTERN.test(line);
}

export function formatServerLogSuffix(errorCount: number): string {
  return errorCount > 0
    ? ` (${errorCount} error message${errorCount === 1 ? '' : 's'})`
    : '';
}

export function writeLogTailToConsole(
  logStore: ServerLogStore,
  lineCount = 100,
  stream: NodeJS.WriteStream = process.stdout,
): void {
  const lines = logStore.tail(lineCount);
  if (lines.length === 0) {
    stream.write('(server log is empty)\n');
    return;
  }
  for (const line of lines) {
    stream.write(`${line.raw}\n`);
  }
}
