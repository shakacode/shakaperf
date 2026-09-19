/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveNetworkActivity } from '../core/network-activity';

const sent = (requestId: string, timestamp: number, url: string) => ({
  method: 'Network.requestWillBeSent',
  params: { requestId, timestamp, request: { url } },
});
const finished = (requestId: string, encodedDataLength: number) => ({
  method: 'Network.loadingFinished',
  params: { requestId, encodedDataLength },
});
const outputPath = () => join(mkdtempSync(join(tmpdir(), 'network-activity-')), 'network_activity.txt');

describe('saveNetworkActivity', () => {
  it('writes size-prefixed rows with a timing line every 500ms and markers in time order', () => {
    const result = {
      artifacts: {
        DevtoolsLog: [
          sent('r1', 100.0, 'http://localhost:3000/'),
          sent('r2', 100.3, 'http://localhost:3000/a.js'),
          sent('r3', 101.2, 'http://localhost:3000/b.js'),
          sent('r4', 102.7, 'http://localhost:3000/c.js'),
          finished('r1', 1024),
          finished('r2', 2048),
        ],
      },
    } as any;
    const out = outputPath();

    const totalBytes = saveNetworkActivity(result, 'http://localhost:3000/', out, 101_000_000, [
      { label: 'Click Shop Now', timestampUs: 101_100_000 },
      { label: 'Wait for products', timestampUs: 103_600_000 },
    ]);

    expect(totalBytes).toBe(3072);
    expect(readFileSync(out, 'utf-8')).toBe([
      '[1.00 KB] /',
      '[2.00 KB] /a.js',
      '--- 0.5s ---',
      '--- 1.0s ---',
      '--- end of downloads-before-LCP stage ---',
      '--- annotation: Click Shop Now ---',
      '[0.00 KB] /b.js',
      '--- 1.5s ---',
      '--- 2.0s ---',
      '--- 2.5s ---',
      '[0.00 KB] /c.js',
      '--- 3.0s ---',
      '--- 3.5s ---',
      '--- annotation: Wait for products ---',
      '',
    ].join('\n'));
  });

  it('appends the LCP marker after the last request when every request started before LCP', () => {
    const result = {
      artifacts: { DevtoolsLog: [sent('r1', 5.0, 'http://localhost:3000/')] },
    } as any;
    const out = outputPath();

    saveNetworkActivity(result, 'http://localhost:3000/', out, 5_300_000);

    expect(readFileSync(out, 'utf-8')).toBe('[0.00 KB] /\n--- end of downloads-before-LCP stage ---\n');
  });
});
