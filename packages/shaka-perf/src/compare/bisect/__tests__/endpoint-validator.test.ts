/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  EndpointMeasurementRunner,
  EndpointValidator,
} from '../endpoint-validator';
import { ExactCheckout, type CheckoutState } from '../git';
import type { CandidateEvaluationPlan, CandidateResult } from '../run-candidate';
import { BisectRunEnvironment } from '../run-environment';

function plan(): CandidateEvaluationPlan {
  return { sha: 'endpoint', categories: [], tests: [], targetIds: [], targets: [] };
}

function result(): CandidateResult {
  return {
    commitRun: {
      sha: 'endpoint', compareCompleted: true, requestedCategories: [], requestedTests: [],
      experimentReloadMode: 'commands', usedFallback: false, startedAt: 'start', finishedAt: 'end',
    },
    testResults: [],
    targetEvaluations: [],
    experimentReload: { mode: 'commands', usedFallback: false },
  };
}

class MemoryCheckout extends ExactCheckout {
  readonly events: string[] = [];
  private state: CheckoutState = { branch: 'main', sha: 'original' };

  constructor(private readonly positionError?: Error, private readonly restoreError?: Error) {
    super({ repoDir: '/unused' });
  }

  override async current() { return { ...this.state }; }

  override async position(sha: string) {
    this.events.push(`position:${sha}`);
    this.state = { branch: null, sha };
    if (this.positionError) throw this.positionError;
    await this.assertAt(sha);
  }

  override async assertAt(sha: string) {
    this.events.push(`verify:${sha}`);
    if (this.state.sha !== sha || this.state.branch !== null) throw new Error('wrong endpoint');
  }

  override async restore(original: CheckoutState) {
    this.events.push(`restore:${original.branch}:${original.sha}`);
    if (this.restoreError) throw this.restoreError;
    this.state = { ...original };
  }
}

describe('EndpointValidator', () => {
  it('positions, verifies, measures, and restores one endpoint', async () => {
    const checkout = new MemoryCheckout();
    const validator = new EndpointValidator(checkout, {
      async evaluate(value) {
        checkout.events.push(`measure:${value.sha}`);
        return result();
      },
    });

    await expect(validator.validate(plan())).resolves.toEqual(result());
    expect(checkout.events).toEqual([
      'position:endpoint', 'verify:endpoint', 'measure:endpoint', 'restore:main:original',
    ]);
  });

  it('restores when endpoint positioning or measurement fails', async () => {
    const position = new MemoryCheckout(new Error('checkout failed'));
    await expect(new EndpointValidator(position, {
      async evaluate() { throw new Error('must not measure'); },
    }).validate(plan())).rejects.toThrow('checkout failed');
    expect(position.events).toEqual(['position:endpoint', 'restore:main:original']);

    const measurement = new MemoryCheckout();
    await expect(new EndpointValidator(measurement, {
      async evaluate() { throw new Error('measurement failed'); },
    }).validate(plan())).rejects.toThrow('measurement failed');
    expect(measurement.events.at(-1)).toBe('restore:main:original');
  });

  it('retains both the endpoint and restoration failures', async () => {
    const checkout = new MemoryCheckout(undefined, new Error('restore failed'));
    const validator = new EndpointValidator(checkout, {
      async evaluate() { throw new Error('measurement failed'); },
    });

    await expect(validator.validate(plan())).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [expect.objectContaining({ message: 'measurement failed' }),
        expect.objectContaining({ message: 'restore failed' })],
    });
  });

  it('preserves a successful measurement when restoration fails', async () => {
    const checkout = new MemoryCheckout(undefined, new Error('restore failed'));
    const validator = new EndpointValidator(checkout, { async evaluate() { return result(); } });

    await expect(validator.validate(plan())).rejects.toMatchObject({
      name: 'EndpointRestoreError',
      result: { commitRun: { sha: 'endpoint', compareCompleted: true } },
      restoreError: expect.objectContaining({ message: 'restore failed' }),
    });
  });
});

describe('EndpointMeasurementRunner', () => {
  it('refreshes and compares without moving the checkout', async () => {
    const events: string[] = [];
    const runner = new EndpointMeasurementRunner(
      {
        async refreshExperiment() {
          events.push('refresh');
          return { mode: 'commands', usedFallback: false };
        },
      },
      {
        async run() {
          events.push('compare');
          return { testResults: [], compareResultsPath: '/results' };
        },
      },
      new BisectRunEnvironment(() => 'now'),
      'commands',
    );

    await expect(runner.evaluate(plan())).resolves.toMatchObject({
      commitRun: { sha: 'endpoint', compareCompleted: true, compareResultsPath: '/results' },
    });
    expect(events).toEqual(['refresh', 'compare']);
  });
});
