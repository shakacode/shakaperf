/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';
import {
  ServerLogStore,
  formatServerLogSuffix,
  isErrorLogLine,
  serverLogPath,
  stripAnsi,
  writeLogTailToConsole,
} from '../helpers/server-log';

function createConfig(tmpDir: string): ResolvedConfig {
  return {
    projectDir: path.join(tmpDir, 'project'),
    experimentDir: path.join(tmpDir, 'project'),
    controlDir: path.join(tmpDir, 'control'),
    dockerBuildDir: path.join(tmpDir, 'project'),
    dockerfile: 'Dockerfile',
    dockerBuildArgs: {},
    composeFile: path.join(tmpDir, 'project', 'docker-compose.yml'),
    procfile: path.join(tmpDir, 'project', 'Procfile'),
    images: { control: 'app:control', experiment: 'app:experiment' },
    volumes: {
      control: path.join(tmpDir, 'volumes', 'control'),
      experiment: path.join(tmpDir, 'volumes', 'experiment'),
    },
    ports: { control: 3021, experiment: 3031 },
    setupCommands: [],
    rebuildCommands: [],
    copyIgnore: { folders: [], files: [] },
    projectSlug: 'test-project',
  };
}

describe('server logs', () => {
  const tmpDir = path.join(__dirname, 'tmp-server-log');

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses one combined log file next to the twin volume directories', () => {
    const config = createConfig(tmpDir);
    expect(serverLogPath(config)).toBe(path.join(tmpDir, 'volumes', 'twin-servers.log'));
  });

  it('writes raw colored output while exposing plain text for the menu', () => {
    const logPath = path.join(tmpDir, 'combined.log');
    const store = new ServerLogStore(logPath);

    store.append('\u001b[31mcontrol | Error: boom\u001b[0m\nexperiment | ok\n');
    store.close();

    expect(fs.readFileSync(logPath, 'utf8')).toBe('\u001b[31mcontrol | Error: boom\u001b[0m\nexperiment | ok\n');
    expect(store.tail(2)).toEqual([
      { raw: '\u001b[31mcontrol | Error: boom\u001b[0m', text: 'control | Error: boom' },
      { raw: 'experiment | ok', text: 'experiment | ok' },
    ]);
    expect(store.errorCount).toBe(1);
  });

  it('counts errors only after a full log line is complete', () => {
    const store = new ServerLogStore(path.join(tmpDir, 'partial.log'));

    store.append('control | Err');
    expect(store.errorCount).toBe(0);

    store.append('or: boom\n');
    expect(store.errorCount).toBe(1);

    store.close();
  });

  it('replays raw tail lines with ANSI color codes intact', () => {
    const store = new ServerLogStore(path.join(tmpDir, 'tail.log'));
    const writes: string[] = [];
    const stream = { write: (chunk: string) => { writes.push(chunk); return true; } } as NodeJS.WriteStream;

    store.append('one\n\u001b[32mtwo\u001b[0m\nthree\n');
    writeLogTailToConsole(store, 2, stream);
    store.close();

    expect(writes.join('')).toBe('\u001b[32mtwo\u001b[0m\nthree\n');
  });

  it('formats issue suffix only when errors exist', () => {
    expect(formatServerLogSuffix(0)).toBe('');
    expect(formatServerLogSuffix(1)).toBe(' (1 error message)');
    expect(formatServerLogSuffix(2)).toBe(' (2 error messages)');
  });

  it('detects common server error lines', () => {
    expect(stripAnsi('\u001b[31mFatal exception\u001b[0m')).toBe('Fatal exception');
    expect(isErrorLogLine('control | ActiveRecord::RecordInvalidError')).toBe(true);
    expect(isErrorLogLine('experiment | Started GET "/"')).toBe(false);
  });
});
