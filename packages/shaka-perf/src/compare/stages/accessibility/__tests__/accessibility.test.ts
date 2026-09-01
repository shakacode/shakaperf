/*
 * Copyright (c) 2026 ShakaCode LLC.
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

import {
  compareScans,
  projectCompareResultForReport,
  runAccessibilityCompareStage,
  summarizeFindings,
} from '../engine';
import {
  DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  type AccessibilityStageConfig,
} from '../../../../audit/stages/accessibility/config';

// Launch options carry no defaults — the pipeline builder always supplies
// them; tests do the same.
const TEST_STAGE_CONFIG: AccessibilityStageConfig = {
  ...DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
};
import { collectFilterOptions, isFindingVisible, primaryCompareTags } from '../report';
import { AccessibilityCompareStage } from '../stage';
import type { AccessibilityCompareFinding, AccessibilitySideScan } from '../types';
import type { AccessibilityViolation } from '../../../../audit/stages/accessibility/types';
import { DESKTOP_VIEWPORT, type AbTestDefinition, type Viewport } from 'shaka-shared';
import type { StageRuntime, TestContext } from '../../../../stage/stage';
import type { WorkerPool } from '../../../../pipeline/worker-pool';
import { applyPerTestConfigOverrides } from '../../../../effective-config';
import { buildAbTestsConfig } from '../../../../config';

describe('accessibility compare classification', () => {
  it('removes raw and comparison artifacts from self-contained reports', () => {
    const stage = new AccessibilityCompareStage(TEST_STAGE_CONFIG);
    expect(stage.selfContainedReportStrip).toEqual({
      comparisonArtifactHref: true,
      control: { rawArtifactHref: true },
      experiment: { rawArtifactHref: true },
    });
  });

  it('matches a violation across sides when only generated class names differ', () => {
    // Real popmenu case: the same MUI box is `.jss162` on control and
    // `.jss192` on experiment because JSS numbers classes in mount order.
    const findings = compareScans(
      scan('control', [violation(
        'region',
        ['.jss192'],
        'moderate',
        '<div class="MuiBox-root jss192 jss188">',
      )]),
      scan('experiment', [violation(
        'region',
        ['.jss162'],
        'moderate',
        '<div class="MuiBox-root jss162 jss158">',
      )]),
    );

    expect(findings.map((finding) => finding.status)).toEqual(['unchanged']);
  });

  it('matches a violation whose compound selector lists its classes in either order', () => {
    const findings = compareScans(
      scan('control', [violation(
        'landmark-unique',
        ['.MuiCollapse-root.MuiCollapse-entered > div[role="region"]'],
        'moderate',
      )]),
      scan('experiment', [violation(
        'landmark-unique',
        ['.MuiCollapse-entered.MuiCollapse-root > div[role="region"]'],
        'moderate',
      )]),
    );

    expect(findings.map((finding) => finding.status)).toEqual(['unchanged']);
  });

  it('keeps distinct elements apart when only their generated names told them apart', () => {
    // Three separate regions, each identified solely by its JSS class. They
    // must stay three findings, not collapse into one because the stable key
    // cannot tell them apart.
    const sides = (offset: number) => [
      violation('region', [`.jss${offset + 1}`], 'moderate', `<div class="jss${offset + 1}">`),
      violation('region', [`.jss${offset + 2}`], 'moderate', `<div class="jss${offset + 2}">`),
      violation('region', [`.jss${offset + 3}`], 'moderate', `<div class="jss${offset + 3}">`),
    ];
    const findings = compareScans(scan('control', sides(190)), scan('experiment', sides(160)));

    expect(findings).toHaveLength(3);
    expect(findings.map((finding) => finding.status)).toEqual(
      ['unchanged', 'unchanged', 'unchanged'],
    );
  });

  it('still reports a genuinely new violation on a stable selector', () => {
    const findings = compareScans(
      scan('control', []),
      scan('experiment', [violation('button-name', ['.checkout-submit'], 'serious')]),
    );

    expect(findings.map((finding) => finding.status)).toEqual(['new']);
  });

  it('renders no artifact when the comparison found nothing to report', () => {
    const stage = new AccessibilityCompareStage(TEST_STAGE_CONFIG);
    const control = scan('control', []);
    const experiment = scan('experiment', []);
    const measurement = {
      control,
      experiment,
      effectiveConfig: { tags: ['wcag2aa'], disableRules: [], includeRules: null },
      failOnViolation: true,
      findings: [],
      summary: summarizeFindings([], control, experiment),
    };

    // An empty element here would render as a blank section inside an
    // otherwise empty card; null lets the report drop both.
    expect(stage.renderArtifacts([{ measurement, viewport: DESKTOP_VIEWPORT }])).toBeNull();
    expect(stage.renderArtifacts([{
      measurement: { ...measurement, findings: [compareFinding({ ruleId: 'button-name', tags: [] })] },
      viewport: DESKTOP_VIEWPORT,
    }])).not.toBeNull();
  });

  it('applies to every test — opting out is testTypes-owned', () => {
    const stage = new AccessibilityCompareStage(TEST_STAGE_CONFIG);

    expect(stage.applies({
      name: 'Any test',
      startingPath: '/',
      file: null,
      line: null,
      testTypes: null,
      testFn: async () => {},
    }, {
      label: 'desktop',
      width: 1280,
      height: 800,
      formFactor: 'desktop',
      deviceScaleFactor: 1,
    })).toBe(true);
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
      TEST_STAGE_CONFIG,
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
      TEST_STAGE_CONFIG,
    );

    expect(result.experiment.blocked).toBe(true);
    expect(result.summary.blocked).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('keeps completed scans with persisted screenshot paths', async () => {
    const browser = fakeBrowser();
    mockChromiumLaunch.mockResolvedValue(browser);
    const result = await runAccessibilityCompareStage(
      fakeContext({}),
      fakeWorkerPool(),
      TEST_STAGE_CONFIG,
    );

    expect(result.summary.errors).toBe(0);
    expect(result.control.screenshot).toEqual({
      width: 100,
      height: 80,
      imageHref: 'checkout-desktop/artifacts/control-accessibility-screenshot.png',
    });
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
  perTest: Partial<AbTestDefinition> = {},
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
    ...perTest,
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
      writeJson: jest.fn(async (name: string) => `checkout-desktop/artifacts/${name}`),
      writeFile: jest.fn(async (name: string) => `checkout-desktop/artifacts/${name}`),
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
      buildAbTestsConfig({ shared: { controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3030', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] } } }),
      test,
    ),
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
    version: jest.fn(() => '150.0.0.0'),
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
        // clearBrowserData creates a throwaway page before the real one now
        // (pre-nav setup runs before the page is created), so the first newPage
        // is the reset page and the real page comes after.
        newPage: jest.fn()
          .mockResolvedValueOnce(resetPage)
          .mockResolvedValue(page),
        newCDPSession: jest.fn(async () => cdpSession),
        clearCookies: jest.fn(async () => {}),
        addInitScript: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
      };
    }),
    close: jest.fn(async () => {}),
    pages,
  };
  return browser;
}
