/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  mergeA11yClientScore,
  mergeA11yClientSummary,
  writeAccessibilityClientScore,
  writeAccessibilityClientSummary,
  writeAccessibilitySiteSummary,
  ACCESSIBILITY_CLIENT_FILENAME,
  ACCESSIBILITY_SITE_FILENAME,
} from '../client-sidecar';
import { readA11yClient } from '../../../../warm-email/client-report';

describe('mergeA11yClientScore', () => {
  it('rounds the score to a whole /100 number', () => {
    expect(mergeA11yClientScore(undefined, 84.2)).toEqual({ score: 84 });
    expect(mergeA11yClientScore(undefined, 94.6)).toEqual({ score: 95 });
  });

  it('preserves an existing AI summary + fixes (order-independent with the AI pass)', () => {
    const existing = { summary: 'Slow main content', fixes: ['add alt text', 'raise contrast'] };
    expect(mergeA11yClientScore(existing, 90)).toEqual({
      summary: 'Slow main content',
      fixes: ['add alt text', 'raise contrast'],
      score: 90,
    });
  });

  it('overwrites a stale score but keeps the rest', () => {
    expect(mergeA11yClientScore({ score: 10, summary: 's' }, 88)).toEqual({ score: 88, summary: 's' });
  });

  it('preserves unknown keys a future pass may have added (lossless)', () => {
    const existing = { summary: 's', wcagLevel: 'AA', details: { foo: 1 } };
    expect(mergeA11yClientScore(existing, 90)).toEqual({
      summary: 's',
      wcagLevel: 'AA',
      details: { foo: 1 },
      score: 90,
    });
  });
});

describe('writeAccessibilityClientScore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-sidecar-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readRaw = (unitDir: string) =>
    JSON.parse(fs.readFileSync(path.join(unitDir, ACCESSIBILITY_CLIENT_FILENAME), 'utf8'));

  it('creates a fresh sidecar with the rounded score', () => {
    writeAccessibilityClientScore(dir, 84.2);
    expect(readRaw(dir)).toEqual({ score: 84 });
  });

  it('merges into an existing AI summary/fixes sidecar without clobbering them', () => {
    fs.writeFileSync(
      path.join(dir, ACCESSIBILITY_CLIENT_FILENAME),
      JSON.stringify({ summary: 'Slow', fixes: ['x'] }),
    );
    writeAccessibilityClientScore(dir, 92);
    expect(readRaw(dir)).toEqual({ summary: 'Slow', fixes: ['x'], score: 92 });
  });

  it('skips a non-finite score and writes no file', () => {
    writeAccessibilityClientScore(dir, Number.NaN);
    expect(fs.existsSync(path.join(dir, ACCESSIBILITY_CLIENT_FILENAME))).toBe(false);
  });

  it('creates the per-page unit dir when missing', () => {
    const nested = path.join(dir, 'home');
    writeAccessibilityClientScore(nested, 88);
    expect(readRaw(nested)).toEqual({ score: 88 });
  });

  it('writes a worst-case score of 0', () => {
    writeAccessibilityClientScore(dir, 0);
    expect(readRaw(dir)).toEqual({ score: 0 });
  });

  it('preserves unknown keys from an existing sidecar on merge (lossless)', () => {
    fs.writeFileSync(
      path.join(dir, ACCESSIBILITY_CLIENT_FILENAME),
      JSON.stringify({ summary: 'Slow', wcagLevel: 'AA' }),
    );
    writeAccessibilityClientScore(dir, 91);
    expect(readRaw(dir)).toEqual({ summary: 'Slow', wcagLevel: 'AA', score: 91 });
  });

  it('recovers from a corrupt existing sidecar by writing a fresh score', () => {
    fs.writeFileSync(path.join(dir, ACCESSIBILITY_CLIENT_FILENAME), '{ not valid json');
    expect(() => writeAccessibilityClientScore(dir, 77)).not.toThrow();
    expect(readRaw(dir)).toEqual({ score: 77 });
  });

  it('round-trips through the client report reader (PR1 contract)', () => {
    const pageId = 'home';
    writeAccessibilityClientScore(path.join(dir, pageId), 87);
    expect(readA11yClient(dir, pageId)?.score).toBe(87);
  });

  it('round-trips a worst-case 0 through the reader (not dropped as falsy)', () => {
    writeAccessibilityClientScore(path.join(dir, 'zero'), 0);
    expect(readA11yClient(dir, 'zero')?.score).toBe(0);
  });
});

describe('mergeA11yClientSummary', () => {
  it('sets summary + fixes on a fresh sidecar', () => {
    expect(mergeA11yClientSummary(undefined, { summary: 's', fixes: ['a', 'b'] })).toEqual({
      summary: 's',
      fixes: ['a', 'b'],
    });
  });

  it('preserves an existing audit-time score (order-independent with the score pass)', () => {
    expect(mergeA11yClientSummary({ score: 88 }, { summary: 's', fixes: ['a'] })).toEqual({
      score: 88,
      summary: 's',
      fixes: ['a'],
    });
  });

  it('overwrites a stale summary/fixes but keeps unknown keys (lossless)', () => {
    const existing = { score: 70, summary: 'old', fixes: ['old'], wcagLevel: 'AA' };
    expect(mergeA11yClientSummary(existing, { summary: 'new', fixes: ['new'] })).toEqual({
      score: 70,
      summary: 'new',
      fixes: ['new'],
      wcagLevel: 'AA',
    });
  });
});

describe('writeAccessibilityClientSummary', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-summary-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readRaw = (unitDir: string) =>
    JSON.parse(fs.readFileSync(path.join(unitDir, ACCESSIBILITY_CLIENT_FILENAME), 'utf8'));

  it('merges into an existing score sidecar without clobbering the score', () => {
    writeAccessibilityClientScore(dir, 92);
    writeAccessibilityClientSummary(dir, { summary: 'Buttons need labels', fixes: ['Add labels'] });
    expect(readRaw(dir)).toEqual({ score: 92, summary: 'Buttons need labels', fixes: ['Add labels'] });
  });

  it('creates a fresh summary sidecar and the per-page dir when missing', () => {
    const nested = path.join(dir, 'home');
    writeAccessibilityClientSummary(nested, { summary: 's', fixes: ['a'] });
    expect(readRaw(nested)).toEqual({ summary: 's', fixes: ['a'] });
  });

  it('recovers from a corrupt existing sidecar', () => {
    fs.writeFileSync(path.join(dir, ACCESSIBILITY_CLIENT_FILENAME), '{ not valid json');
    expect(() => writeAccessibilityClientSummary(dir, { summary: 's', fixes: ['a'] })).not.toThrow();
    expect(readRaw(dir)).toEqual({ summary: 's', fixes: ['a'] });
  });

  it('round-trips through the client report reader', () => {
    writeAccessibilityClientScore(path.join(dir, 'home'), 80);
    writeAccessibilityClientSummary(path.join(dir, 'home'), { summary: 's', fixes: ['a', 'b'] });
    const read = readA11yClient(dir, 'home');
    expect(read).toEqual({ score: 80, summary: 's', fixes: ['a', 'b'] });
  });
});

describe('writeAccessibilitySiteSummary', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-site-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readRaw = () => JSON.parse(fs.readFileSync(path.join(dir, ACCESSIBILITY_SITE_FILENAME), 'utf8'));

  it('writes the site summary file', () => {
    writeAccessibilitySiteSummary(dir, 'Across the site, labels are missing.');
    expect(readRaw()).toEqual({ summary: 'Across the site, labels are missing.' });
  });

  it('merges losslessly, preserving any other key', () => {
    fs.writeFileSync(path.join(dir, ACCESSIBILITY_SITE_FILENAME), JSON.stringify({ generatedAt: 'x' }));
    writeAccessibilitySiteSummary(dir, 'New summary');
    expect(readRaw()).toEqual({ generatedAt: 'x', summary: 'New summary' });
  });
});
