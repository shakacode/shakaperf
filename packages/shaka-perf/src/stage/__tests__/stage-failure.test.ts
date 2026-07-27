/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactScope, type ArtifactPath } from '../../pipeline/artifact-store';
import { attachLatestTestAnnotation } from '../../test-annotation';
import {
  captureFailureScreenshot,
  findFailureArtifacts,
  findLastAnnotation,
  StageFailureError,
} from '../stage-failure';

const FAILURE_MEDIA_PATH = 'cart-phone/artifacts/failure-screenshot.png' as ArtifactPath;

describe('captureFailureScreenshot', () => {
  let resultsRoot: string;

  beforeEach(() => {
    resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-failure-shot-'));
  });

  afterEach(() => {
    fs.rmSync(resultsRoot, { recursive: true, force: true });
  });

  it('captures, persists, and returns a report-relative path', async () => {
    const artifactsDir = path.join(resultsRoot, 'cart-phone', 'artifacts');
    const artifacts = new ArtifactScope(artifactsDir, resultsRoot);

    await expect(captureFailureScreenshot(
      artifacts,
      async () => Buffer.from('experiment screenshot'),
    )).resolves.toBe('cart-phone/artifacts/failure-screenshot.png');
    expect(fs.readFileSync(path.join(artifactsDir, 'failure-screenshot.png')))
      .toEqual(Buffer.from('experiment screenshot'));
  });

  it('returns undefined instead of replacing the original failure', async () => {
    const artifacts = new ArtifactScope(
      path.join(resultsRoot, 'cart-phone', 'artifacts'),
      resultsRoot,
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(captureFailureScreenshot(
        artifacts,
        async () => { throw new Error('page already closed'); },
      )).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns undefined when persisting the captured bytes fails', async () => {
    const blockedDir = path.join(resultsRoot, 'not-a-directory');
    fs.writeFileSync(blockedDir, 'blocking file');
    const artifacts = new ArtifactScope(
      path.join(blockedDir, 'artifacts'),
      resultsRoot,
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(captureFailureScreenshot(
        artifacts,
        async () => Buffer.from('screenshot'),
      )).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('StageFailureError', () => {
  it('surfaces the underlying cause stack without wrapper frames', () => {
    const cause = new Error('Failed while waiting for cart drawer');
    cause.stack = [
      'Error: Failed while waiting for cart drawer',
      '    at waitForCartDrawer (ab-tests/popmenu-order-checkout.abtest.ts:47:11)',
      '    at async addToCart (ab-tests/popmenu-order-checkout.abtest.ts:32:3)',
    ].join('\n');

    const err = new StageFailureError(cause, { media: FAILURE_MEDIA_PATH });

    expect(err.message).toBe('Failed while waiting for cart drawer');
    expect(err.stack).toBe(`StageFailureError: Failed while waiting for cart drawer\nCaused by: ${cause.stack}`);
    expect(err.stack).toContain('at waitForCartDrawer (ab-tests/popmenu-order-checkout.abtest.ts:47:11)');
    expect(err.stack).not.toContain('at StageFailureError');
  });

  it('finds the latest test annotation attached by the framework through wrapper errors', () => {
    const cause = new Error('Failed while waiting for the validation result');
    cause.stack = [
      'Error: Failed while waiting for the validation result',
      '    at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)',
    ].join('\n');
    attachLatestTestAnnotation(cause, 'Submit cart');

    const err = new StageFailureError(cause, { media: FAILURE_MEDIA_PATH });

    expect(err.message).toBe('Failed while waiting for the validation result');
    expect(findLastAnnotation(err)).toBe('Submit cart');
    expect(err.stack).toContain('at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)');
  });

  it('finds the failure artifacts on a bare StageFailureError', () => {
    const err = new StageFailureError(new Error('boom'), { media: FAILURE_MEDIA_PATH });

    expect(findFailureArtifacts(err)?.media).toBe(FAILURE_MEDIA_PATH);
  });

  it('finds the failure artifacts through the worker pool\'s poison wrapper', () => {
    // A stage that throws from inside a pool task has its StageFailureError
    // wrapped once the retry budget is spent. An `instanceof` check on the
    // outer error drops the media — which is how visreg failures reached the
    // report with no error screenshot.
    const stageFailure = new StageFailureError(new Error('page.waitForSelector: Timeout'), {
      media: FAILURE_MEDIA_PATH,
    });
    const poison = new Error('worker 0 exhausted 1 consecutive attempts; cancelling test+viewport', {
      cause: stageFailure,
    });

    expect(poison instanceof StageFailureError).toBe(false);
    expect(findFailureArtifacts(poison)?.media).toBe(FAILURE_MEDIA_PATH);
  });

  it('returns undefined when nothing in the chain carries artifacts', () => {
    expect(findFailureArtifacts(new Error('plain'))).toBeUndefined();
    expect(findFailureArtifacts(new Error('outer', { cause: new Error('inner') }))).toBeUndefined();
  });

  it('keeps multi-line Playwright call logs only in the cause stack', () => {
    const cause = new Error([
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
    ].join('\n'));
    cause.stack = [
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
      '',
      '    at Object._testFn (ab-tests/cart.abtest.ts:54:16)',
    ].join('\n');

    const err = new StageFailureError(cause, { media: FAILURE_MEDIA_PATH });

    expect(err.stack).toContain('StageFailureError: page.waitForSelector: Timeout 30000ms exceeded.');
    expect(err.stack?.match(/Call log:/g)).toHaveLength(1);
    expect(err.stack).toContain('at Object._testFn (ab-tests/cart.abtest.ts:54:16)');
  });
});
