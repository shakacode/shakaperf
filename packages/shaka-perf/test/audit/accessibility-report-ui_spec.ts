/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
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
    expect(html).toContain('class="a11y-rule-group__issues"');
    expect(html).toContain('class="a11y-issue-node"');
    expect(html).toContain('.secondary-link');
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
