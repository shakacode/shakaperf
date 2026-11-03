/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { App } from '../../report-shell/src/App';
import type { ReportData } from '../../src/pipeline/report';
import {
  AccessibilityArtifactView,
  AccessibilityReportFilterProvider,
  collectConfiguredFilterOptions,
} from '../../src/audit/stages/accessibility/report';
import { AccessibilityDialog } from '../../src/audit/stages/accessibility/report-dialog';
import { AccessibilityFilter } from '../../src/audit/stages/accessibility/report-filter';
import type {
  AccessibilityResult,
  AccessibilityViolation,
} from '../../src/audit/stages/accessibility/types';

describe('accessibility report UI filters', () => {
  it('keeps accessibility filtering in the modal instead of the report header or section heading', () => {
    const data = reportData(accessibilityResult({
      effectiveConfig: {
        tags: ['wcag2a', 'wcag2aa'],
        disableRules: [],
        includeRules: ['focus-order-semantics'],
      },
      violations: [
        violation('button-name', ['wcag2a']),
        violation('color-contrast', ['wcag2aa']),
        violation('focus-order-semantics', ['best-practice']),
      ],
    }));

    const html = renderToStaticMarkup(React.createElement(App, { data }));

    expect(html).not.toContain('accessibility filters ·');
    expect(html).toContain('aria-label="accessibility in all test cards"');
    expect(html).not.toContain('report sections filter');
  });

  it('fails loud for an unreconstructable pipeline', () => {
    const data = reportData(accessibilityResult({ violations: [] }));
    data.meta.pipelineName = 'legacy';
    expect(() => renderToStaticMarkup(React.createElement(App, { data }))).toThrow(/Unknown pipeline "legacy"/);
  });

  it('keeps the screenshot preview mounted when active accessibility filters hide every finding', () => {
    const result = accessibilityResult({
      violations: [
        violation('button-name', ['wcag2a']),
        violation('color-contrast', ['wcag2aa']),
      ],
    });
    const options = collectConfiguredFilterOptions([result]);

    const html = renderToStaticMarkup(
      React.createElement(
        AccessibilityReportFilterProvider,
        {
          value: {
            options,
            selection: { rules: new Set<string>(), tags: new Set<string>() },
            setSelection: jest.fn(),
          },
          children: React.createElement(AccessibilityArtifactView, {
            measurements: [{
              latestRun: true,
              measurement: result,
              viewport: DESKTOP_VIEWPORT,
            }],
          }),
        },
      ),
    );

    expect(html).toContain('inspect screenshot');
    expect(html).toContain('0 of 2 rule violations');
    expect(html).toContain('2 accessibility findings hidden by the current accessibility filter.');
  });

  it('shows configured tag chips on compact accessibility violation rows', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessibilityArtifactView, {
        measurements: [{
          latestRun: true,
          measurement: accessibilityResult({
            effectiveConfig: {
              tags: ['wcag2a', 'wcag2aa'],
              disableRules: [],
              includeRules: null,
            },
            violations: [
              violation('button-name', ['wcag2a', 'cat.name-role-value']),
              violation('color-contrast', ['wcag2aa', 'cat.color']),
            ],
          }),
          viewport: DESKTOP_VIEWPORT,
        }],
      }),
    );

    expect(html).toContain('a11y-tag-chip');
    expect(html).toContain('wcag2a');
    expect(html).toContain('wcag2aa');
    expect(html).not.toContain('cat.color');
  });

  it('renders audit accessibility rules as collapsible groups with node details inside', () => {
    const result = accessibilityResult({
      effectiveConfig: {
        tags: ['wcag2a', 'wcag2aa'],
        disableRules: [],
        includeRules: null,
      },
      violations: [
        violation('button-name', ['wcag2a']),
        {
          ...violation('color-contrast', ['wcag2aa']),
          nodes: [
            violation('color-contrast', ['wcag2aa']).nodes[0],
            {
              ...violation('color-contrast', ['wcag2aa']).nodes[0],
              target: ['.secondary-link'],
              bounds: undefined,
            },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(
      React.createElement(AccessibilityDialog, {
        filterOptions: collectConfiguredFilterOptions([result]),
        scan: result.scans[0],
        source: result.scans[0].screenshot!.imageHref ?? '',
      }),
    );

    expect(html).toContain('class="a11y-rule-group" data-active="false"');
    expect(html).toContain(
      'aria-label="color-contrast serious wcag2aa Fix it 2 nodes"',
    );
    expect(html).toContain('class="a11y-rule-group__summary"');
    expect(html).toContain('2 nodes');
    expect(html).not.toContain('affected node');
    expect(html).not.toContain('screenshot marker');
    expect(html).toContain('class="a11y-rule-group__issues"');
    expect(html).toContain('class="a11y-issue-node"');
    expect(html).toContain('.secondary-link');
  });

  it('ships filter CSS for readable hover states, closable filters, and non-scrollable dialog panels', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessibilityArtifactView, {
        measurements: [{
          latestRun: true,
          measurement: accessibilityResult({
            violations: [violation('button-name', ['wcag2a'])],
          }),
          viewport: DESKTOP_VIEWPORT,
        }],
      }),
    );

    expect(html).toContain(
      '.a11y-filter__button[data-muted="true"]:not(:hover):not([data-open="true"])',
    );
    expect(html).toContain('max-height: none;');
    expect(html).toContain('overflow: visible;');
    expect(html).toContain('grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));');
    expect(html).toContain('.a11y-filter__close');
    expect(html).toContain('.a11y-rule-group__summary::before');
    expect(html).toContain('.a11y-rule-group[open] > .a11y-rule-group__summary::before');
    expect(html).toContain('.a11y-hotspot[data-active="true"] {\n  z-index: 1000000 !important;');
    expect(html).toContain('.a11y-hotspot:hover,\n.a11y-hotspot:focus {\n  z-index: 2000000 !important;');
  });

  it('can render a single-test filter action for applying the local selection globally', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessibilityFilter, {
        defaultOpen: true,
        extraActions: React.createElement('button', { type: 'button' }, 'apply globally'),
        options: {
          rules: [],
          tags: [
            { value: 'wcag2a', count: 1 },
            { value: 'wcag2aa', count: 1 },
          ],
        },
        selection: {
          rules: new Set<string>(),
          tags: new Set(['wcag2a']),
        },
        setSelection: jest.fn(),
        title: 'test filters',
        variant: 'panel',
      }),
    );

    expect(html).toContain('test filters · 1/2');
    expect(html).toContain('apply globally');
  });


});

function reportData(accessibility: AccessibilityResult): ReportData {
  return {
    meta: {
      title: 'Synthetic audit',
      pipelineName: 'audit',
      generatedAt: new Date(0).toISOString(),
      controlUrl: 'http://localhost:3090',
      experimentUrl: 'http://localhost:3090',
      durationMs: 1000,
      cwd: '/tmp/shaka-perf',
      errors: [],
      reportOnly: false,
      reportMode: 'self-contained',
      pipelineConfig: {
        parallelism: 1,
        accessibility: {
          ...accessibility.effectiveConfig,
          includeRules: accessibility.effectiveConfig.includeRules ?? undefined,
          engineOptions: { browser: 'chromium' },
          failOnViolation: accessibility.failOnViolation,
        },
      },
    },
    tests: [{
      id: 'synthetic-accessibility',
      name: 'Synthetic Accessibility',
      filePath: 'ab-tests/synthetic.abtest.ts',
      startingPath: '/',
      controlUrl: 'http://localhost:3090/',
      experimentUrl: 'http://localhost:3090/',
      code: null,
      chips: [{
        tag: 'accessibility violation',
        text: 'accessibility: 3 violations',
        color: 'red',
        sortingWeight: -10,
      }],
      sorts: [],
      durationMs: 1000,
      measuredAt: 0,
      runId: 'run-1',
      viewportArtifactPaths: [],
      outcomes: [{
        kind: 'ok',
        stage: 'accessibility',
        viewport: DESKTOP_VIEWPORT,
        measurement: accessibility,
      }],
    }],
  };
}

function accessibilityResult({
  effectiveConfig = {
    tags: ['wcag2a', 'wcag2aa'],
    disableRules: [],
    includeRules: null,
  },
  violations,
}: {
  effectiveConfig?: AccessibilityResult['effectiveConfig'];
  violations: AccessibilityViolation[];
}): AccessibilityResult {
  return {
    totalViolations: violations.length,
    failOnViolation: true,
    effectiveConfig,
    scans: [{
      viewportLabel: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      url: 'http://localhost:3090/',
      screenshot: {
        width: 800,
        height: 600,
        imageHref: 'data:image/svg+xml;base64,PHN2Zy8+',
      },
      violations,
    }],
  };
}

function violation(ruleId: string, tags: string[]): AccessibilityViolation {
  return {
    ruleId,
    impact: 'serious',
    help: 'Fix it',
    helpUrl: `https://example.test/${ruleId}`,
    tags,
    nodes: [{
      target: [`.${ruleId}`],
      html: `<div class="${ruleId}"></div>`,
      failureSummary: 'Fix this node',
      bounds: {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    }],
  };
}
