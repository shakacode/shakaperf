/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { ReportData, ReportOutcome } from '../../src/pipeline/report';

export const TALL_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="4096"><rect width="390" height="4096" fill="#ece7dc"/><rect width="390" height="200" fill="#17324d"/><text x="24" y="100" fill="white" font-size="30">PAGE TOP</text><rect x="20" y="2000" width="350" height="120" fill="#c45c36"/><rect y="3896" width="390" height="200" fill="#24654d"/><text x="20" y="3996" fill="white" font-size="30">PAGE BOTTOM</text></svg>')}`;
export const WIDE_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="720"><rect width="2560" height="720" fill="#17324d"/><rect x="2200" width="360" height="720" fill="#24654d"/><text x="80" y="200" fill="white" font-size="80">WIDE DESKTOP</text></svg>')}`;

export function imageModalFixture(pipeline: 'audit' | 'compare' = 'audit'): ReportData {
  const screenshot = { width: 390, height: 4096, imageHref: TALL_IMAGE };
  const violation = {
    ruleId: 'button-name', impact: 'serious', help: 'Buttons need accessible names',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name', tags: ['wcag2a'],
    nodes: [{ target: ['button.checkout'], html: '<button class="checkout"></button>', failureSummary: 'Add an accessible name', bounds: { x: 20, y: 2000, width: 350, height: 120 } }],
  };
  const config = { tags: ['wcag2a'], disableRules: [], includeRules: null };
  const ok = (stage: string, measurement: unknown) => ({ kind: 'ok', stage, viewport: DESKTOP_VIEWPORT, measurement }) as ReportOutcome;
  const error = { kind: 'error', stage: pipeline === 'audit' ? 'audit' : 'visreg', viewport: DESKTOP_VIEWPORT, error: { message: 'Example navigation failure' }, failure: { media: TALL_IMAGE } } as ReportOutcome;
  const outcomes = pipeline === 'audit' ? [
    ok('code_coverage', { files: 1, coveredStatements: 2, totalStatements: 3, screenshotHref: TALL_IMAGE }),
    ok('code_coverage', { files: 1, coveredStatements: 2, totalStatements: 3, screenshotHref: WIDE_IMAGE }),
    ok('accessibility', { scans: [{ viewportLabel: 'mobile-tall', viewport: DESKTOP_VIEWPORT, url: 'https://example.test', screenshot, violations: [violation] }], totalViolations: 1, failOnViolation: false, effectiveConfig: config }),
  ] : [
    ok('visreg', [{ selector: 'body', controlImage: TALL_IMAGE, experimentImage: TALL_IMAGE, diffImage: TALL_IMAGE, misMatchPercentage: 1, diffBbox: { x: 20, y: 2000, w: 350, h: 120, imgW: 390, controlImgH: 4096, experimentImgH: 4096, diffImgH: 4096 } }]),
    ok('visreg', [{ selector: 'body', controlImage: WIDE_IMAGE, experimentImage: WIDE_IMAGE, diffImage: null, misMatchPercentage: 0 }]),
    ok('accessibility', { control: { side: 'control', url: 'https://example.test', screenshot, violations: [] }, experiment: { side: 'experiment', url: 'https://example.test', screenshot, violations: [violation] }, effectiveConfig: config, failOnViolation: false, findings: [{ signature: 'checkout', status: 'new', ruleId: violation.ruleId, impact: violation.impact, tags: violation.tags, experiment: violation }], summary: { new: 1, fixed: 0, changed: 0, unchanged: 0, blocked: 0, newByImpact: { serious: 1 }, fixedByImpact: {}, changedByImpact: {} } }),
  ];
  return {
    meta: { title: 'Image sizing verification', pipelineName: pipeline, pipelineConfig: {}, generatedAt: new Date(0).toISOString(), controlUrl: 'https://example.test', experimentUrl: 'https://example.test', cwd: '/tmp/image-modal', errors: [], durationMs: 1000, reportOnly: true, reportMode: 'full' },
    tests: [...outcomes, error].map((outcome, index) => ({ id: `image-${index}`, name: ['Tall mobile image', 'Wide desktop image', 'Accessibility annotations', 'Failure screenshot'][index], filePath: 'images.abtest.ts', startingPath: '/', controlUrl: 'https://example.test', experimentUrl: 'https://example.test', code: null, chips: [], sorts: [], durationMs: 1000, measuredAt: 0, runId: 'image-sizing', viewportArtifactPaths: [], outcomes: [outcome] })),
  };
}
