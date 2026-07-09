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
  compareScans,
  projectCompareResultForReport,
  runAccessibilityCompareStage,
  summarizeFindings,
} from '../engine';
import { DEFAULT_ACCESSIBILITY_STAGE_CONFIG } from '../../../../audit/stages/accessibility/config';
import { bufferToAvifDataUri } from '../../../../pipeline/artifact-compression';
import { collectFilterOptions, isFindingVisible, primaryCompareTags } from '../report';
import { AccessibilityCompareStage } from '../stage';
import type { AccessibilityCompareFinding, AccessibilitySideScan } from '../types';
import type { AccessibilityViolation } from '../../../../audit/stages/accessibility/types';
import { DESKTOP_VIEWPORT, type AbTestDefinition, type Viewport } from 'shaka-shared';
import type { StageRuntime, TestContext } from '../../../../stage/stage';
import type { WorkerPool } from '../../../../pipeline/worker-pool';

describe('accessibility compare classification', () => {
  it('honors per-test accessibility skip config', () => {
    const stage = new AccessibilityCompareStage();

    expect(stage.applies({
      name: 'Skip me',
      startingPath: '/',
      file: null,
      line: null,
      options: { accessibility: { skip: true } },
      testTypes: null,
      testFn: async () => {},
    }, {
      label: 'desktop',
      width: 1280,
      height: 800,
      formFactor: 'desktop',
      deviceScaleFactor: 1,
    })).toBe(false);
  });

  it('classifies new, fixed, unchanged, and changed findings by rule and target', () => {
    const unchanged = violation('html-has-lang', ['html'], 'serious');
    const changedControl = violation('color-contrast', ['.price'], 'moderate', 'old text');
    const changedExperiment = violation('color-contrast', ['.price'], 'serious', 'new text');
    const fixed = violation('button-name', ['button.old'], 'critical');
    const added = violation('aria-label', ['button.new'], 'serious');

    const findings = compareScans(
      scan('control', [unchanged, changedControl, fixed]),
      scan('experiment', [unchanged, changedExperiment, added]),
    );

    expect(findings.map((finding) => [finding.ruleId, finding.status])).toEqual([
      ['aria-label', 'new'],
      ['button-name', 'fixed'],
      ['color-contrast', 'changed'],
      ['html-has-lang', 'unchanged'],
    ]);
    expect(summarizeFindings(findings, scan('control', []), scan('experiment', [])))
      .toMatchObject({
        new: 1,
        fixed: 1,
        changed: 1,
        unchanged: 1,
        errors: 0,
        newByImpact: { serious: 1 },
        fixedByImpact: { critical: 1 },
        changedByImpact: { serious: 1 },
      });
  });

  it('summarizes side scan errors without implying accessibility deltas', () => {
    const summary = summarizeFindings([], {
      ...scan('control', []),
      error: 'control failed',
    }, scan('experiment', [violation('color-contrast', ['.price'], 'serious')]));

    expect(summary).toMatchObject({
      new: 0,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 1,
    });
  });

  it('summarizes bot-blocked side scans without implying accessibility deltas', () => {
    const summary = summarizeFindings([], {
      ...scan('control', []),
      blocked: true,
    }, scan('experiment', [violation('color-contrast', ['.price'], 'serious')]));

    expect(summary).toMatchObject({
      new: 0,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 0,
      blocked: 1,
    });
  });

  it('does not collapse ordered shadow DOM target paths into one finding', () => {
    const control = shadowViolation('label', ['shop-card', 'button']);
    const experiment = shadowViolation('label', ['button', 'shop-card']);

    const findings = compareScans(
      scan('control', [control]),
      scan('experiment', [experiment]),
    );

    expect(findings.map((finding) => finding.status).sort()).toEqual(['fixed', 'new']);
  });

  it('truncates verbose node fields in report-safe comparison output', () => {
    const control = scan('control', [
      violation('color-contrast', ['.price'], 'serious', 'x'.repeat(800), 'y'.repeat(2500)),
    ]);
    const experiment = scan('experiment', [
      violation('color-contrast', ['.price'], 'serious', 'x'.repeat(800), 'y'.repeat(2500)),
    ]);
    const projected = projectCompareResultForReport({
      control,
      experiment,
      effectiveConfig: {
        tags: ['wcag2aa'],
        disableRules: [],
        includeRules: null,
      },
      failOnViolation: true,
      findings: compareScans(control, experiment),
      summary: summarizeFindings([], control, experiment),
    });

    const sideNode = projected.control.violations[0].nodes[0];
    const findingNode = projected.findings[0].control!.nodes[0];
    expect(sideNode.html).toContain('[truncated from 800 chars]');
    expect(sideNode.failureSummary).toContain('[truncated from 2500 chars]');
    expect(findingNode.html).toContain('[truncated from 800 chars]');
    expect(findingNode.failureSummary).toContain('[truncated from 2500 chars]');
  });

  it('uses WCAG-focused tags for compare report filters and chips', () => {
    const finding = compareFinding({
      ruleId: 'color-contrast',
      tags: ['cat.color', 'wcag21aa', 'wcag2aa', 'wcag2aa'],
    });
    const options = collectFilterOptions([
      finding,
      compareFinding({
        ruleId: 'button-name',
        tags: ['best-practice', 'cat.name-role-value'],
      }),
    ]);

    expect([...options.tags]).toEqual(['wcag2aa', 'wcag21aa', 'best-practice']);
    expect(primaryCompareTags(finding.tags)).toEqual(['wcag2aa', 'wcag21aa']);
    expect(isFindingVisible(finding, {
      statuses: new Set(['new']),
      impacts: new Set(['serious']),
      rules: new Set(['color-contrast']),
      tags: new Set(['wcag2aa']),
    })).toBe(true);
    expect(isFindingVisible(finding, {
      statuses: new Set(['new']),
      impacts: new Set(['serious']),
      rules: new Set(['color-contrast']),
      tags: new Set(['best-practice']),
    })).toBe(false);
  });
});

describe('accessibility compare engine', () => {
  const originalRealChrome = process.env.SHAKAPERF_REAL_CHROME;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SHAKAPERF_REAL_CHROME;
    mockAxeAnalyze.mockResolvedValue({
      url: 'http://localhost/scan',
      violations: [],
    });
    (bufferToAvifDataUri as jest.MockedFunction<typeof bufferToAvifDataUri>)
      .mockResolvedValue('data:image/avif;base64,test');
  });

  afterEach(() => {
    if (originalRealChrome === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = originalRealChrome;
  });

  it('uses real-Chrome launch options and mobile emulation when enabled', async () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    const browser = fakeBrowser();
    mockChromiumLaunch.mockResolvedValue(browser);

    await runAccessibilityCompareStage(
      fakeContext({ headed: false }, {}, jest.fn(async () => {}), mobileViewport()),
      fakeWorkerPool(),
      DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
    );

    expect(mockChromiumLaunch).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'chrome',
      headless: false,
      args: expect.arrayContaining(['--disable-blink-features=AutomationControlled']),
    }));
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      hasTouch: true,
      userAgent: expect.stringContaining('Mobile'),
    }));
  });

  it('marks bot-blocked sides and suppresses accessibility deltas', async () => {
    const browser = fakeBrowser({
      probeBySide: {
        control: { title: 'Real page', html: '<main>ok</main>' },
        experiment: { title: 'Just a moment...', html: '<main>__cf_chl challenge-platform</main>' },
      },
    });
    mockChromiumLaunch.mockResolvedValue(browser);
    mockAxeAnalyze.mockResolvedValue({
      url: 'http://localhost/scan',
      violations: [{
        id: 'button-name',
        impact: 'critical',
        help: 'Buttons need text',
        helpUrl: '',
        tags: ['wcag2a'],
        nodes: [{
          target: ['button'],
          html: '<button></button>',
          failureSummary: 'Fix any of the following',
        }],
      }],
    });

    const result = await runAccessibilityCompareStage(
      fakeContext({}),
      fakeWorkerPool(),
      DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
    );

    expect(result.experiment.blocked).toBe(true);
    expect(result.summary.blocked).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('keeps completed scans when inline screenshot encoding fails', async () => {
    const browser = fakeBrowser();
    mockChromiumLaunch.mockResolvedValue(browser);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (bufferToAvifDataUri as jest.MockedFunction<typeof bufferToAvifDataUri>)
      .mockRejectedValueOnce(new Error('Processed image is too large for the HEIF format'));

    try {
      const result = await runAccessibilityCompareStage(
        fakeContext({}),
        fakeWorkerPool(),
        DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
      );

      expect(result.summary.errors).toBe(0);
      expect(result.control.screenshot?.imageHref).toBe('checkout-desktop/artifacts/control-accessibility-screenshot.png');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('inline screenshot encode failed'));
    } finally {
      warn.mockRestore();
    }
  });
});

function scan(
  side: AccessibilitySideScan['side'],
  violations: AccessibilityViolation[],
): AccessibilitySideScan {
  return {
    side,
    url: `http://localhost/${side}`,
    violations,
  };
}

function violation(
  ruleId: string,
  target: string[],
  impact: AccessibilityViolation['impact'],
  html = '<button>ok</button>',
  failureSummary = `${ruleId} failure`,
): AccessibilityViolation {
  return {
    ruleId,
    impact,
    help: `${ruleId} help`,
    helpUrl: `https://example.test/${ruleId}`,
    tags: ['wcag2aa'],
    nodes: [{
      target,
      html,
      failureSummary,
    }],
  };
}

function shadowViolation(ruleId: string, shadowPath: string[]): AccessibilityViolation {
  return {
    ruleId,
    impact: 'serious',
    help: `${ruleId} help`,
    helpUrl: `https://example.test/${ruleId}`,
    tags: ['wcag2aa'],
    nodes: [{
      target: [shadowPath],
      html: '<button>ok</button>',
      failureSummary: `${ruleId} failure`,
    }],
  };
}

function compareFinding({
  ruleId,
  tags,
}: {
  ruleId: string;
  tags: string[];
}): AccessibilityCompareFinding {
  return {
    status: 'new',
    signature: `${ruleId}|target`,
    ruleId,
    impact: 'serious',
    tags,
    experiment: {
      impact: 'serious',
      help: `${ruleId} help`,
      helpUrl: `https://example.test/${ruleId}`,
      tags,
      nodes: [{
        target: ['target'],
        html: '<button>ok</button>',
        failureSummary: `${ruleId} failure`,
      }],
    },
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
  options: AbTestDefinition['options'] = {},
  testFn = jest.fn(async () => {}),
  viewport = DESKTOP_VIEWPORT,
): TestContext {
  const test = {
    file: '/tmp/product.abtest.ts',
    line: 1,
    name: 'Checkout',
    startingPath: '/checkout',
    testTypes: ['accessibility'],
    experimentPathOverride: undefined,
    options,
    testFn,
  } as AbTestDefinition;
  return {
    test,
    viewport,
    controlURL: 'http://localhost:3030/control',
    experimentURL: 'http://localhost:3031/experiment',
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
  } as unknown as TestContext;
}

function mobileViewport(): Viewport {
  return {
    ...DESKTOP_VIEWPORT,
    label: 'phone',
    width: 390,
    height: 844,
    formFactor: 'mobile',
  };
}

function fakeBrowser(options: {
  probeBySide?: Partial<Record<AccessibilitySideScan['side'], { title: string; html: string }>>;
} = {}) {
  let contextIndex = 0;
  const sides: AccessibilitySideScan['side'][] = ['control', 'experiment'];
  const pages: Record<string, unknown> = {};
  const browser = {
    newContext: jest.fn(async () => {
      const side = sides[contextIndex++] ?? 'experiment';
      const probe = options.probeBySide?.[side] ?? { title: 'Real page', html: '<main>ok</main>' };
      const page = {
        setDefaultTimeout: jest.fn(),
        setDefaultNavigationTimeout: jest.fn(),
        goto: jest.fn(async () => {}),
        waitForTimeout: jest.fn(async () => {}),
        evaluate: jest.fn(async (_fn: unknown, arg?: unknown) => {
          if (Array.isArray(arg)) {
            return arg.map(() => ({ x: 1, y: 2, width: 3, height: 4 }));
          }
          return probe;
        }),
        screenshot: jest.fn(async () => Buffer.from('png')),
      };
      pages[side] = page;
      const resetPage = {
        close: jest.fn(async () => {}),
      };
      const cdpSession = {
        send: jest.fn(async () => {}),
        detach: jest.fn(async () => {}),
      };
      return {
        newPage: jest.fn()
          .mockResolvedValueOnce(page)
          .mockResolvedValue(resetPage),
        newCDPSession: jest.fn(async () => cdpSession),
        clearCookies: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
      };
    }),
    close: jest.fn(async () => {}),
    pages,
  };
  return browser;
}
