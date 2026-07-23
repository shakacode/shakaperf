/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

const mockChromiumLaunch = jest.fn();
const mockFirefoxLaunch = jest.fn();
const mockWebkitLaunch = jest.fn();
const mockAxeAnalyze = jest.fn();

jest.mock('playwright-core', () => ({
  chromium: { launch: mockChromiumLaunch },
  firefox: { launch: mockFirefoxLaunch },
  webkit: { launch: mockWebkitLaunch },
}));

jest.mock('@axe-core/playwright', () => jest.fn().mockImplementation(() => {
  const builder: {
    withRules: jest.Mock;
    withTags: jest.Mock;
    disableRules: jest.Mock;
    analyze: jest.Mock;
  } = {
    withRules: jest.fn(() => builder),
    withTags: jest.fn(() => builder),
    disableRules: jest.fn(() => builder),
    analyze: mockAxeAnalyze,
  };
  return builder;
}));

jest.mock('sharp', () => jest.fn(() => ({
  metadata: jest.fn(async () => ({ width: 100, height: 80 })),
})));

jest.mock('../../../../pipeline/artifact-compression', () => ({
  bufferToAvifDataUri: jest.fn(async () => 'data:image/avif;base64,test'),
}));

import {
  DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  type AccessibilityStageConfig,
} from '../config';
import { normalizeViolation, projectAccessibilityRawArtifact } from '../artifacts';
import {
  collectConfiguredFilterOptions,
  countFilterOptionsForScans,
  defaultAccessibilityFilterSelection,
  hasAccessibilityFilterOptions,
  isViolationVisibleForFilters,
  isViolationVisibleForTags,
  normalizeAccessibilityFilterSelection,
} from '../report';
import { runAccessibilityStage } from '../engine';
import { bufferToAvifDataUri } from '../../../../pipeline/artifact-compression';
import { AccessibilityStage } from '../stage';
import { resolveDialogFilterSelection } from '../report-dialog';
import type { AccessibilityRawArtifact, AccessibilityResult, AccessibilityViolation } from '../types';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { AbTestDefinition } from 'shaka-shared';
import type { StageRuntime, TestContext } from '../../../../stage/stage';
import type { WorkerPool } from '../../../../pipeline/worker-pool';
import { applyPerTestConfigOverrides } from '../../../../effective-config';
import { parseAbTestsConfig } from '../../../../config';
import { DEFAULT_ACCESSIBILITY_TAGS } from '../../../../config';

// Launch options carry no defaults — the pipeline builder always supplies
// them; tests do the same.
const TEST_STAGE_CONFIG: AccessibilityStageConfig = {
  ...DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  playwrightOptions: { browser: 'chromium' },
};

describe('accessibility config defaults', () => {
  it('uses the shared accessibility tag defaults', () => {
    expect(DEFAULT_ACCESSIBILITY_STAGE_CONFIG.tags).toEqual([...DEFAULT_ACCESSIBILITY_TAGS]);
  });
});

describe('accessibility artifact projection', () => {
  it('normalizes axe rule tags from scan results', () => {
    const normalized = normalizeViolation({
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/color-contrast',
      tags: ['wcag2aa', 'cat.color', 'wcag2aa'],
      nodes: [],
    } as never);

    expect(normalized.tags).toEqual(['wcag2aa', 'cat.color']);
  });

  it('truncates verbose node fields for report payloads', () => {
    const raw: AccessibilityRawArtifact = {
      testName: 'Checkout',
      experimentURL: 'http://localhost:3030/checkout',
      effectiveConfig: {
        tags: ['wcag2aa'],
        disableRules: [],
        includeRules: null,
      },
      scans: [{
        viewportLabel: 'desktop',
        viewport: DESKTOP_VIEWPORT,
        url: 'http://localhost:3030/checkout',
        violations: [{
          ruleId: 'button-name',
          impact: 'critical',
          help: 'Buttons must have discernible text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
          tags: ['wcag2a', 'best-practice'],
          nodes: [{
            target: ['button.primary'],
            html: 'x'.repeat(800),
            failureSummary: 'y'.repeat(2500),
          }],
        }],
      }],
    };

    const result = projectAccessibilityRawArtifact(raw, {
      failOnViolation: true,
      rawArtifactHref: 'checkout/artifacts/accessibility-report.json',
    });
    const node = result.scans[0].violations[0].nodes[0];

    expect(result.totalViolations).toBe(1);
    expect(result.rawArtifactHref).toBe('checkout/artifacts/accessibility-report.json');
    expect(node.html).toHaveLength(530);
    expect(node.html).toContain('[truncated from 800 chars]');
    expect(node.failureSummary).toHaveLength(2031);
    expect(node.failureSummary).toContain('[truncated from 2500 chars]');
    expect(result.scans[0].violations[0].tags).toEqual(['wcag2a', 'best-practice']);
  });
});

describe('accessibility report filtering', () => {
  it('builds filter options from configured tags and includeRules', () => {
    const result = accessibilityResult({
      effectiveConfig: {
        tags: ['wcag2a', 'wcag2aa'],
        disableRules: [],
        includeRules: ['button-name'],
      },
      violations: [
        violation('button-name', ['best-practice']),
        violation('color-contrast', ['wcag2aa', 'cat.color']),
      ],
    });

    expect(collectConfiguredFilterOptions([result])).toEqual({
      rules: [{ value: 'button-name', count: 1 }],
      tags: [
        { value: 'wcag2a', count: 0 },
        { value: 'wcag2aa', count: 1 },
      ],
    });
  });

  it('recounts global filter options against a single test scan', () => {
    const first = accessibilityResult({
      effectiveConfig: {
        tags: ['wcag2a', 'wcag2aa'],
        disableRules: [],
        includeRules: ['button-name'],
      },
      violations: [
        violation('button-name', ['wcag2a']),
        violation('color-contrast', ['wcag2aa']),
      ],
    });
    const second = accessibilityResult({
      effectiveConfig: {
        tags: ['wcag2a', 'wcag2aa'],
        disableRules: [],
        includeRules: ['button-name'],
      },
      violations: [
        violation('button-name', ['wcag2a']),
        violation('html-has-lang', ['wcag2a']),
      ],
    });
    const globalOptions = collectConfiguredFilterOptions([first, second]);

    expect(globalOptions).toEqual({
      rules: [{ value: 'button-name', count: 2 }],
      tags: [
        { value: 'wcag2a', count: 3 },
        { value: 'wcag2aa', count: 1 },
      ],
    });
    expect(countFilterOptionsForScans(globalOptions, first.scans)).toEqual({
      rules: [{ value: 'button-name', count: 1 }],
      tags: [
        { value: 'wcag2a', count: 1 },
        { value: 'wcag2aa', count: 1 },
      ],
    });
  });

  it('uses inclusive OR matching across checked tags and included rules', () => {
    const bestPractice = violation('button-name', ['best-practice']);
    const contrast = violation('color-contrast', ['wcag2aa', 'cat.color']);
    const selection = {
      rules: new Set(['button-name']),
      tags: new Set(['wcag2aa']),
    };

    expect(isViolationVisibleForTags(bestPractice, new Set(['wcag2a', 'best-practice']))).toBe(true);
    expect(isViolationVisibleForTags(bestPractice, new Set(['wcag2a']))).toBe(false);
    expect(isViolationVisibleForFilters(bestPractice, selection)).toBe(true);
    expect(isViolationVisibleForFilters(contrast, selection)).toBe(true);
    expect(isViolationVisibleForFilters(violation('aria-hidden-focus', ['best-practice']), selection)).toBe(false);
  });

  it('filter helpers do not change total violations or failure semantics', () => {
    const result = accessibilityResult({
      failOnViolation: true,
      violations: [
        violation('button-name', ['best-practice']),
        violation('color-contrast', ['wcag2aa']),
      ],
    });
    const visible = result.scans[0].violations.filter((candidate) =>
      isViolationVisibleForFilters(candidate, {
        rules: new Set(),
        tags: new Set(['wcag2aa']),
      }),
    );

    expect(visible.map((candidate) => candidate.ruleId)).toEqual(['color-contrast']);
    expect(result.totalViolations).toBe(2);
    expect(result.failOnViolation).toBe(true);
  });

  it('normalizes shared filter selection when report-wide options change', () => {
    const options = collectConfiguredFilterOptions([
      accessibilityResult({
        effectiveConfig: {
          tags: ['wcag2a', 'wcag2aa'],
          disableRules: [],
          includeRules: ['button-name'],
        },
        violations: [
          violation('button-name', ['wcag2a']),
          violation('color-contrast', ['wcag2aa']),
        ],
      }),
    ]);
    const selected = defaultAccessibilityFilterSelection(options);

    expect(hasAccessibilityFilterOptions(options)).toBe(true);
    expect(selected.rules).toEqual(new Set(['button-name']));
    expect(selected.tags).toEqual(new Set(['wcag2a', 'wcag2aa']));
    expect(normalizeAccessibilityFilterSelection({
      rules: new Set(['button-name', 'stale-rule']),
      tags: new Set(['wcag2aa', 'stale-tag']),
    }, options)).toEqual({
      rules: new Set(['button-name']),
      tags: new Set(['wcag2aa']),
    });
  });

  it('lets a single-test filter selection override the global selection without merging', () => {
    const options = {
      rules: [{ value: 'button-name', count: 1 }],
      tags: [
        { value: 'wcag2a', count: 1 },
        { value: 'wcag2aa', count: 1 },
      ],
    };
    const globalSelection = {
      rules: new Set(['button-name']),
      tags: new Set(['wcag2a']),
    };
    const localSelection = {
      rules: new Set<string>(),
      tags: new Set(['wcag2aa']),
    };

    expect(resolveDialogFilterSelection({
      globalSelection,
      localSelection,
      options,
    })).toEqual(localSelection);
    expect(resolveDialogFilterSelection({
      globalSelection,
      localSelection: null,
      options,
    })).toEqual(globalSelection);
    expect(resolveDialogFilterSelection({
      globalSelection: null,
      localSelection: null,
      options,
    })).toEqual(defaultAccessibilityFilterSelection(options));
  });
});

describe('accessibility report modes', () => {
  it('keeps linked screenshots for full reports and inline screenshots for lightweight reports', () => {
    const stage = new AccessibilityStage(TEST_STAGE_CONFIG);
    const raw: AccessibilityRawArtifact = {
      testName: 'Checkout',
      experimentURL: 'http://localhost:3030/checkout',
      effectiveConfig: {
        tags: ['wcag2aa'],
        disableRules: [],
        includeRules: null,
      },
      scans: [{
        viewportLabel: 'desktop',
        viewport: DESKTOP_VIEWPORT,
        url: 'http://localhost:3030/checkout',
        screenshot: {
          width: 1280,
          height: 800,
          imageHref: 'checkout/artifacts/accessibility-screenshot.png',
          imageDataUri: 'data:image/avif;base64,thumb',
        },
        violations: [],
      }],
    };
    const result = projectAccessibilityRawArtifact(raw, {
      failOnViolation: true,
      rawArtifactHref: 'checkout/artifacts/accessibility-report.json',
    });

    expect(stage.stripMeasurementForFull!(result).scans[0].screenshot).toEqual({
      width: 1280,
      height: 800,
      imageHref: 'checkout/artifacts/accessibility-screenshot.png',
    });
    expect(stage.stripMeasurementForLightweight!(result).scans[0].screenshot).toEqual({
      width: 1280,
      height: 800,
      imageDataUri: 'data:image/avif;base64,thumb',
    });
    expect(stage.stripMeasurementForLightweight!(result).rawArtifactHref).toBeUndefined();
  });
});

describe('accessibility browser launch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxeAnalyze.mockResolvedValue({
      url: 'http://localhost:3030/checkout',
      violations: [],
    });
  });

  it('honors the audit --headed runtime flag', async () => {
    mockChromiumLaunch.mockResolvedValue(fakeBrowser());

    await runAccessibilityStage(
      fakeContext({ headed: true }),
      fakeWorkerPool(),
      {
        ...TEST_STAGE_CONFIG,
        playwrightOptions: {
          ...TEST_STAGE_CONFIG.playwrightOptions,
          headless: true,
        },
      },
    );

    expect(mockChromiumLaunch).toHaveBeenCalledWith(expect.objectContaining({
      headless: false,
    }));
  });

  it('runs perf-style pre-navigation setup before accessibility navigation', async () => {
    const events: string[] = [];
    mockChromiumLaunch.mockResolvedValue(fakeBrowser({ events }));

    await runAccessibilityStage(
      fakeContext(
        {},
        {
          config: {
            shared: {
              beforeNavigate: jest.fn(async ({ context, testType, url }) => {
                events.push('beforeNavigate');
                expect(context).toBeDefined();
                expect(testType).toBe('accessibility');
                expect(url).toBe('http://localhost:3030/checkout');
              }),
            },
          },
        },
        jest.fn(async () => {
          events.push('testFn');
        }),
      ),
      fakeWorkerPool(),
      TEST_STAGE_CONFIG,
    );

    // Browser state is cleared BEFORE the beforeNavigate hooks (so a hook that
    // seeds an auth cookie survives into the navigation), and all of it runs
    // before the page is created — uniform with the perf/visreg engines.
    expect(events).toEqual([
      'clearCookies',
      'cdp:Network.clearBrowserCache',
      'cdp:Network.clearBrowserCookies',
      'cdp:Storage.clearDataForOrigin',
      'cdp:detach',
      'beforeNavigate',
      'goto',
      'testFn',
    ]);
  });

  it('keeps the page and its violations when the inline screenshot encode fails', async () => {
    mockChromiumLaunch.mockResolvedValue(fakeBrowser());
    mockAxeAnalyze.mockResolvedValue({
      url: 'http://localhost:3030/checkout',
      violations: [
        { id: 'button-name', impact: 'critical', help: 'Buttons need text', helpUrl: '', tags: ['wcag2a'], nodes: [] },
      ],
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (bufferToAvifDataUri as jest.MockedFunction<typeof bufferToAvifDataUri>).mockRejectedValueOnce(
      new Error('Processed image is too large for the HEIF format'),
    );

    try {
      const result = await runAccessibilityStage(
        fakeContext({}),
        fakeWorkerPool(),
        TEST_STAGE_CONFIG,
      );

      // The PNG is on disk and the violations were computed before the
      // screenshot, so the stage still delivers its primary output - only the
      // inline crop source is dropped.
      expect(result.totalViolations).toBe(1);
      expect(result.scans[0].violations[0].ruleId).toBe('button-name');
      const screenshot = result.scans[0].screenshot;
      expect(screenshot?.imageHref).toBe('checkout-desktop/artifacts/accessibility-screenshot.png');
      expect(screenshot?.imageDataUri).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('inline screenshot encode failed'));
    } finally {
      warn.mockRestore();
    }
  });

});

function violation(ruleId: string, tags: string[]): AccessibilityViolation {
  return {
    ruleId,
    impact: 'serious',
    help: 'Fix it',
    helpUrl: `https://example.test/${ruleId}`,
    tags,
    nodes: [],
  };
}

function accessibilityResult({
  effectiveConfig = {
    tags: ['wcag2aa'],
    disableRules: [],
    includeRules: null,
  },
  failOnViolation = true,
  violations,
}: {
  effectiveConfig?: AccessibilityResult['effectiveConfig'];
  failOnViolation?: boolean;
  violations: AccessibilityViolation[];
}): AccessibilityResult {
  return {
    totalViolations: violations.length,
    failOnViolation,
    effectiveConfig,
    scans: [{
      viewportLabel: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      url: 'http://localhost:3030/checkout',
      violations,
    }],
  };
}

function fakeWorkerPool(): WorkerPool {
  const workerState = { workerIndex: 0 };
  return {
    submit: jest.fn((run) => run(workerState)),
    getWorkerState: jest.fn((state) => state),
  } as unknown as WorkerPool;
}

function fakeContext(
  runtime: Partial<StageRuntime>,
  perTest: Partial<AbTestDefinition> = {},
  testFn = jest.fn(async () => {}),
): TestContext {
  const test = {
    file: '/tmp/product.abtest.ts',
    line: 1,
    name: 'Checkout',
    startingPath: '/checkout',
    testTypes: ['accessibility'],
    experimentPathOverride: undefined,
    ...perTest,
    testFn,
  } as AbTestDefinition;
  return {
    test,
    viewport: DESKTOP_VIEWPORT,
    controlURL: 'http://localhost:3030/checkout',
    experimentURL: 'http://localhost:3030/checkout',
    testAndViewportId: 'checkout-desktop',
    artifacts: {
      dir: '/tmp/shaka-test/checkout-desktop/artifacts',
      writeJson: jest.fn(async () => {}),
      writeFile: jest.fn(async () => {}),
    },
    logger: {
      log: jest.fn(),
      flush: jest.fn(() => ''),
    },
    priorOutcomes: new Map(),
    runtime: {
      ...runtime,
      resultsRoot: runtime.resultsRoot ?? '/tmp/shaka-test',
    },
    readPriorResult: jest.fn(),
    raceCancellation: jest.fn(),
    config: applyPerTestConfigOverrides(
      parseAbTestsConfig({ shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3030', parallelism: 1, playwrightOptions: { browser: 'chromium' } } }),
      test,
    ),
  } as unknown as TestContext;
}

function fakeBrowser(options: { events?: string[] } = {}) {
  const events = options.events;
  const page = {
    setDefaultTimeout: jest.fn(),
    setDefaultNavigationTimeout: jest.fn(),
    goto: jest.fn(async () => { events?.push('goto'); }),
    waitForSelector: jest.fn(async () => {}),
    evaluate: jest.fn(async () => {}),
    on: jest.fn(),
    removeListener: jest.fn(),
    screenshot: jest.fn(async () => Buffer.from('png')),
  };
  const resetPage = {
    close: jest.fn(async () => {}),
  };
  const cdpSession = {
    send: jest.fn(async (method: string) => { events?.push(`cdp:${method}`); }),
    detach: jest.fn(async () => { events?.push('cdp:detach'); }),
  };
  const context = {
    // clearBrowserData creates a throwaway page (before the real one, now that
    // pre-nav setup runs before the page is created), so the first newPage is
    // the reset page and the real page comes after.
    newPage: jest.fn()
      .mockResolvedValueOnce(resetPage)
      .mockResolvedValue(page),
    newCDPSession: jest.fn(async () => cdpSession),
    clearCookies: jest.fn(async () => { events?.push('clearCookies'); }),
    addCookies: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
  };
  return {
    newContext: jest.fn(async () => context),
    close: jest.fn(async () => {}),
    page,
    context,
  };
}
