import { compareScans, projectCompareResultForReport, summarizeFindings } from '../engine';
import { collectFilterOptions, isFindingVisible, primaryCompareTags } from '../report';
import { AccessibilityCompareStage } from '../stage';
import type { AccessibilityCompareFinding, AccessibilitySideScan } from '../types';
import type { AccessibilityViolation } from '../../../../audit/stages/accessibility/types';

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
