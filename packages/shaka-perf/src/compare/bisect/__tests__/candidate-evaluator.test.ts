/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import {
  CandidateEvaluationError,
  CandidateEvaluator,
  type CandidateEvaluationPlan,
} from '../run-candidate';
import { BisectRunEnvironment } from '../run-environment';
import type { TestResult } from '../../../pipeline/report';

class FixedEnvironment extends BisectRunEnvironment {
  private tick = 0;

  override now(): string {
    return `2026-07-26T00:00:0${this.tick++}.000Z`;
  }
}

function plan(): CandidateEvaluationPlan {
  return {
    sha: 'candidate',
    categories: ['visreg'],
    tests: [{ testFile: 'home.abtest.ts', testName: 'Home' }],
    targetIds: [],
    targets: [],
  };
}

function evaluator(options: {
  actualSha?: string;
  refreshError?: Error;
  comparisonError?: Error;
  environment?: BisectRunEnvironment;
} = {}) {
  const events: string[] = [];
  const value = new CandidateEvaluator(
    {
      async assertAtCandidate(expectedSha) {
        events.push(`verify:${expectedSha}`);
        if ((options.actualSha ?? expectedSha) !== expectedSha) {
          throw new Error(`wrong candidate ${options.actualSha}`);
        }
      },
    },
    {
      async refreshExperiment() {
        events.push('refresh');
        if (options.refreshError) throw options.refreshError;
        return { mode: 'commands', usedFallback: false };
      },
    },
    {
      async run() {
        events.push('compare');
        if (options.comparisonError) throw options.comparisonError;
        return { testResults: [] as TestResult[], compareResultsPath: '/results' };
      },
    },
    options.environment ?? new FixedEnvironment(),
    'commands',
  );
  return { events, value };
}

describe('CandidateEvaluator', () => {
  it('verifies native Git before refreshing and comparing', async () => {
    const { events, value } = evaluator();

    const result = await value.evaluate(plan());

    expect(events).toEqual(['verify:candidate', 'refresh', 'compare']);
    expect(result.commitRun).toMatchObject({
      sha: 'candidate',
      compareCompleted: true,
      compareResultsPath: '/results',
      startedAt: '2026-07-26T00:00:00.000Z',
      finishedAt: '2026-07-26T00:00:01.000Z',
    });
  });

  it('never refreshes when native Git is not at the requested candidate', async () => {
    const { events, value } = evaluator({ actualSha: 'other' });

    await expect(value.evaluate(plan())).rejects.toMatchObject({
      name: 'CandidateEvaluationError',
      commitRun: expect.objectContaining({ infrastructureError: 'wrong candidate other' }),
    });
    expect(events).toEqual(['verify:candidate']);
  });

  it('returns failure metadata without persisting it', async () => {
    const { value } = evaluator({ comparisonError: new Error('browser crashed') });

    let rejection: unknown;
    try {
      await value.evaluate(plan());
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(CandidateEvaluationError);
    expect((rejection as CandidateEvaluationError).commitRun).toMatchObject({
      compareCompleted: false,
      infrastructureError: 'browser crashed',
      experimentReloadMode: 'commands',
    });
  });

  it('preserves cancellation as the original failure without classifying infrastructure', async () => {
    const environment = new FixedEnvironment();
    environment.cancel('SIGINT');
    const { events, value } = evaluator({ environment });

    await expect(value.evaluate(plan())).rejects.toMatchObject({
      commitRun: expect.not.objectContaining({ infrastructureError: expect.anything() }),
      originalError: expect.objectContaining({ name: 'BisectInterruptedError' }),
    });
    expect(events).toEqual(['verify:candidate']);
  });
});
