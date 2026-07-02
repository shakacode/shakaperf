/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AuditResult } from '../audit/stages/audit/stage';
import type { AccessibilityResult } from '../audit/stages/accessibility/types';
import type { AgentReadinessResult } from '../audit/stages/agent_readiness/types';
import type { ChipDescriptor } from '../pipeline/report';
import type { Outcome } from '../pipeline/outcome';

// Cross-page synthesis over a SAVED audit-results directory. shaka-perf computes
// the worst metric WITHIN a page but does not rank pages against each other;
// "which page is slowest across the site" + the site-wide picture is computed
// here. Reads report.json (page list, summaries, chips) + each
// <results>/<test-id>/audit.json (numeric metrics).

// The slice of `report.json` this module consumes. The payload itself is the
// anonymous object `writeMachineReport` builds (pipeline/report.ts) - it has no
// exported interface, so the fields are mirrored here; everything is optional
// because saved results may come from older shaka-perf versions.
export interface MachineReportTest {
  id?: string | number;
  name?: string;
  startingPath?: string;
  viewport?: { label?: string; width?: number; height?: number };
  chips?: Partial<ChipDescriptor>[];
  outcomes?: { summary?: { summary?: unknown } }[];
}
interface MachineReport {
  meta?: { experimentUrl?: string; controlUrl?: string; generatedAt?: string };
  tests?: MachineReportTest[];
}

export interface PageMetric {
  value: number;
  display: string;
  level?: string;
  unit?: string;
}

export interface PagePerf {
  id: string;
  name: string;
  startingPath: string;
  chips: string[];
  metrics: Record<string, PageMetric>;
  summary?: string;
  // The accessibility stage's measurement for this page, when the saved audit
  // ran the `accessibility` category. Read from <results>/<id>/accessibility.json
  // (same per-test Outcome file convention as audit.json). Absent on audits that
  // predate the accessibility stage or skipped it - the client report then simply
  // shows no Accessibility tab (see client-report.ts).
  a11y?: AccessibilityResult;
  // The agent-readiness stage's measurement for this page, read from
  // <results>/<id>/agent-readiness.json. Absent on audits that predate the stage
  // or skipped it - the client report then shows no "Agent Ready" tab.
  agentReady?: AgentReadinessResult;
}

export interface Stat {
  min: number;
  max: number;
  avg: number;
}

export interface SiteScorecard {
  url: string;
  generatedAt: string;
  pageCount: number;
  pages: PagePerf[];
  slowestByLcp?: PagePerf;
  heaviestByDownload?: PagePerf;
  worstByScore?: PagePerf;
  lcpMs: Stat | null;
  score: Stat | null;
  brokenCount: number;
}

function metricVal(p: PagePerf, label: string): number | undefined {
  const m = p.metrics[label];
  return m && typeof m.value === 'number' && !Number.isNaN(m.value) ? m.value : undefined;
}

function stat(values: number[]): Stat | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

// Guard a loaded agent-readiness `rendered` PageSignals against the fields the
// scorer dereferences deeply, so a malformed/truncated artifact is rejected at
// load instead of throwing inside scoring and failing the whole report.
function isValidPageSignals(s: unknown): boolean {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  if (typeof o.textWords !== 'number') return false;
  return ['headings', 'landmarks', 'links', 'images', 'structuredData', 'og'].every(
    (k) => typeof o[k] === 'object' && o[k] !== null,
  );
}

// report.json flattens to one row per (test, viewport) and the default audit
// config runs BOTH desktop and phone. The client report's copy and numbers are
// phone-framed, so only phone-class rows may feed it; counting every row would
// double the page count and blend desktop LCPs into the "phone" averages.
// Legacy results with no viewport field pass through unchanged.
export function selectViewportRows(tests: MachineReportTest[]): MachineReportTest[] {
  const phoneRows = tests.filter((t) => t.viewport?.label !== undefined && /phone|mobile/i.test(String(t.viewport.label)));
  if (phoneRows.length > 0) return phoneRows;
  if (tests.some((t) => t.viewport?.label !== undefined) && tests.length > 0) {
    console.warn('shaka-perf: report.json has viewport rows but none are phone-class - the client report assumes mobile measurements; rendering all rows.');
  }
  return tests;
}

export function synthesizeSite(resultsDir: string): SiteScorecard {
  const reportPath = path.join(resultsDir, 'report.json');
  let report: MachineReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as MachineReport;
  } catch (err) {
    throw new Error(`${reportPath} is not valid JSON (interrupted audit?): ${(err as Error).message}`);
  }
  const meta = report.meta ?? {};
  const tests: MachineReportTest[] = selectViewportRows(Array.isArray(report.tests) ? report.tests : []);

  const pages: PagePerf[] = tests.map((t): PagePerf => {
    const metrics: Record<string, PageMetric> = {};
    const auditPath = path.join(resultsDir, String(t.id), 'audit.json');
    if (fs.existsSync(auditPath)) {
      try {
        // audit.json is the audit stage's persisted Outcome (artifact-store
        // writes `${outcome.stage}.json`); its measurement is an AuditResult.
        const outcome = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as Outcome;
        const ms = (outcome.measurement as Partial<AuditResult> | undefined)?.metrics ?? [];
        for (const m of ms) {
          if (m && m.label) {
            metrics[String(m.label)] = {
              value: Number(m.value),
              display: String(m.display ?? ''),
              level: m.level,
              unit: m.unit,
            };
          }
        }
      } catch {
        // unreadable audit.json -> page has no metrics, still listed
      }
    }
    let summary: string | undefined;
    for (const o of (t.outcomes ?? [])) {
      const s = o?.summary?.summary;
      if (s) summary = String(s);
    }
    // accessibility.json is the accessibility stage's persisted Outcome (same
    // `${stage}.json` convention as audit.json); its measurement is an
    // AccessibilityResult carrying the per-page axe violations + the inline
    // full-page screenshot. Absent on audits that did not run the stage.
    let a11y: AccessibilityResult | undefined;
    const a11yPath = path.join(resultsDir, String(t.id), 'accessibility.json');
    if (fs.existsSync(a11yPath)) {
      try {
        const outcome = JSON.parse(fs.readFileSync(a11yPath, 'utf8')) as Outcome;
        const measurement = outcome.measurement as AccessibilityResult | undefined;
        if (measurement && Array.isArray(measurement.scans)) a11y = measurement;
      } catch {
        // unreadable accessibility.json -> page simply has no Accessibility card
      }
    }
    // agent-readiness.json is the agent-readiness stage's persisted Outcome (same
    // `${stage}.json` convention as audit.json / accessibility.json); its
    // measurement is an AgentReadinessResult. Absent on audits that did not run it.
    let agentReady: AgentReadinessResult | undefined;
    const agentPath = path.join(resultsDir, String(t.id), 'agent-readiness.json');
    if (fs.existsSync(agentPath)) {
      try {
        const outcome = JSON.parse(fs.readFileSync(agentPath, 'utf8')) as Outcome;
        const measurement = outcome.measurement as AgentReadinessResult | undefined;
        // Validate the shape the scorer relies on: a truncated/corrupt file (e.g.
        // `{rendered:{}}` from an interrupted write) would otherwise throw deep
        // inside scoring and sink the WHOLE report. Require the load-bearing
        // fields before accepting it; an invalid file simply yields no Agent card.
        if (measurement && isValidPageSignals(measurement.rendered)) agentReady = measurement;
      } catch {
        // unreadable agent-readiness.json -> page simply has no Agent Ready card
      }
    }
    const chips: string[] = Array.isArray(t.chips)
      ? t.chips.map((c) => c?.tag).filter((x): x is string => Boolean(x))
      : [];
    return {
      id: String(t.id),
      name: String(t.name ?? t.id),
      startingPath: String(t.startingPath ?? ''),
      chips,
      metrics,
      summary,
      ...(a11y ? { a11y } : {}),
      ...(agentReady ? { agentReady } : {}),
    };
  });

  const withLcp = pages.filter((p) => metricVal(p, 'LCP') !== undefined);
  const withScore = pages.filter((p) => metricVal(p, 'LH Score') !== undefined);
  const withDl = pages.filter((p) => metricVal(p, 'downloads') !== undefined);

  return {
    url: meta.experimentUrl ?? meta.controlUrl ?? '',
    generatedAt: meta.generatedAt ?? '',
    pageCount: pages.length,
    pages,
    slowestByLcp: [...withLcp].sort((a, b) => metricVal(b, 'LCP')! - metricVal(a, 'LCP')!)[0],
    heaviestByDownload: [...withDl].sort((a, b) => metricVal(b, 'downloads')! - metricVal(a, 'downloads')!)[0],
    worstByScore: [...withScore].sort((a, b) => metricVal(a, 'LH Score')! - metricVal(b, 'LH Score')!)[0],
    lcpMs: stat(withLcp.map((p) => metricVal(p, 'LCP')!)),
    score: stat(withScore.map((p) => metricVal(p, 'LH Score')!)),
    brokenCount: pages.filter((p) => p.chips.some((c) => /broke/i.test(c))).length,
  };
}

const sec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// A readable block of the trustworthy numbers (LCP, score, page weight) for the
// generation prompt + the DETAILS section. Speed Index and FCP are intentionally
// NOT surfaced: SI is unreliable on animated sites and FCP framing is handled in
// the prompt rules (see ../../README-warm-email.md).
export function formatScorecard(sc: SiteScorecard): string {
  const lines: string[] = [];
  lines.push(`Site: ${sc.url}`);
  lines.push(`Pages audited: ${sc.pageCount} (mobile emulation, the Slow-4G throttling profile Google PageSpeed uses)`);
  if (sc.lcpMs) {
    lines.push(`Main-content load (LCP) across pages: ${sec(sc.lcpMs.min)} to ${sec(sc.lcpMs.max)} (avg ${sec(sc.lcpMs.avg)})`);
  }
  if (sc.score) {
    lines.push(`Performance score: ${Math.round(sc.score.min)} to ${Math.round(sc.score.max)} (avg ${Math.round(sc.score.avg)} out of 100)`);
  }
  if (sc.slowestByLcp) {
    lines.push(`Slowest page: ${sc.slowestByLcp.startingPath || sc.slowestByLcp.name} (LCP ${sec(metricVal(sc.slowestByLcp, 'LCP')!)})`);
  }
  if (sc.heaviestByDownload) {
    const dl = sc.heaviestByDownload.metrics['downloads'];
    lines.push(`Heaviest page: ${sc.heaviestByDownload.startingPath || sc.heaviestByDownload.name} (${dl?.display ?? ''} downloaded)`);
  }
  if (sc.brokenCount > 0) lines.push(`Pages flagged broken: ${sc.brokenCount}`);
  lines.push('');
  lines.push('Per page (path: LCP, score, page weight):');
  for (const p of sc.pages) {
    const lcp = metricVal(p, 'LCP');
    const score = metricVal(p, 'LH Score');
    const dl = p.metrics['downloads'];
    lines.push(
      `- ${p.startingPath || p.name}: LCP ${lcp !== undefined ? sec(lcp) : 'n/a'}, ` +
        `score ${score !== undefined ? Math.round(score) : 'n/a'}, ` +
        `${dl?.display ?? 'n/a'}${p.summary ? ` - "${p.summary}"` : ''}`,
    );
  }
  return lines.join('\n');
}
