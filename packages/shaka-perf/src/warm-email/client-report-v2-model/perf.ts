/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { V2Status } from '../client-report-v2';
import type { PagePerf } from '../synthesis';

const LCP_GOOD_MS = 2500;
const LCP_SLOW_MS = 10000;
export const LCP_WAIT_MS = 4000; // a visitor notices the wait above this
const V2_LCP_ACCEPTABLE_MS = 4000;
const V2_FCP_GOOD_MS = 1800;
const V2_FCP_POOR_MS = 3000;
const V2_TBT_GOOD_MS = 200;
const V2_TBT_POOR_MS = 600;
export const CLS_GOOD = 10;
const CLS_POOR = 25;
const FCP_BLANK_MS = 8000; // nothing painted for this long = effectively blank
const FCP_LATE_MS = 3500; // first paint noticeably late
const TBT_SLUGGISH_MS = 600;
const SCORE_GOOD = 90;
const SCORE_POOR = 50;
export const VISIBLE_SHIFT = 0.02;

export type Status = 'good' | 'fair' | 'poor';

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function metricVal(p: PagePerf, label: string): number | undefined {
  const m = p.metrics[label];
  return m && typeof m.value === 'number' && !Number.isNaN(m.value) ? m.value : undefined;
}

export function lcpStatus(ms: number | undefined): Status {
  if (ms === undefined) return 'fair';
  if (ms <= LCP_GOOD_MS) return 'good';
  if (ms <= LCP_SLOW_MS) return 'fair';
  return 'poor';
}

export function v2LcpStatus(ms: number | undefined): V2Status {
  if (ms === undefined) return 'fair';
  if (ms <= V2_LCP_ACCEPTABLE_MS) return 'good';
  if (ms <= LCP_SLOW_MS) return 'fair';
  return 'poor';
}

export function v2FcpStatus(ms: number | undefined): V2Status {
  if (ms === undefined) return 'good';
  if (ms <= V2_FCP_GOOD_MS) return 'good';
  if (ms <= V2_FCP_POOR_MS) return 'fair';
  return 'poor';
}

export function v2ClsStatus(v: number | undefined): V2Status {
  return clsStatus(v);
}

export function v2TbtStatus(ms: number | undefined): V2Status {
  if (ms === undefined) return 'good';
  if (ms <= V2_TBT_GOOD_MS) return 'good';
  if (ms <= V2_TBT_POOR_MS) return 'fair';
  return 'poor';
}

export function scoreStatus(score: number | undefined): Status {
  if (score === undefined) return 'fair';
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_POOR) return 'fair';
  return 'poor';
}

export function clsStatus(v: number | undefined): Status {
  if (v === undefined) return 'good';
  if (v <= CLS_GOOD) return 'good';
  if (v <= CLS_POOR) return 'fair';
  return 'poor';
}

export type ProblemKind = 'slow-lcp' | 'layout-shift' | 'blank' | 'late-paint' | 'sluggish' | 'clean' | 'no-data';

export interface Problem {
  kind: ProblemKind;
  severity: number; // 0..1, for ranking which problem leads the card
  status: Status;
  headline: string; // HTML, the bold lead line
  note?: string; // one plain clause under the headline
  chip: string; // short label when shown as a secondary problem
}

export function detectProblems(page: PagePerf): { lead: Problem; rest: Problem[] } {
  const lcp = metricVal(page, 'LCP');
  const fcp = metricVal(page, 'FCP');
  const clsV = metricVal(page, 'CLS'); // /100 scale
  const tbt = metricVal(page, 'TBT');
  const score = metricVal(page, 'LH Score');

  if (lcp === undefined && fcp === undefined && clsV === undefined && tbt === undefined && score === undefined) {
    return {
      lead: {
        kind: 'no-data',
        severity: 0,
        status: 'fair',
        headline: `We couldn't measure this page`,
        note: 'The audit did not complete here, so no numbers are claimed for it.',
        chip: 'not measured',
      },
      rest: [],
    };
  }
  const out: Problem[] = [];

  if (lcp !== undefined && lcp > LCP_GOOD_MS) {
    const paintsEarly = fcp !== undefined && fcp <= 3000 && lcp - fcp >= 3000;
    const note = paintsEarly
      ? 'Most of the page paints early, so the wait is easy to miss - but the biggest piece of the page only lands then.'
      : lcp > LCP_WAIT_MS
        ? 'Until then a visitor on a phone is looking at a mostly empty screen.'
        : 'A bit slower than the under-2.5-second mark that feels instant on a phone.';
    out.push({
      kind: 'slow-lcp',
      severity: clamp01(lcp / 14000),
      status: lcpStatus(lcp),
      headline: `The biggest piece of the page takes <strong>${secs(lcp)}</strong> to appear`,
      note,
      chip: `biggest piece at ${secs(lcp)}`,
    });
  }
  if (clsV !== undefined && clsV > CLS_GOOD) {
    const raw = (clsV / 100).toFixed(2);
    const note = clsV > CLS_POOR
      ? `The page scores ${raw} on Google's layout-shift scale, where anything above 0.25 is poor - so things move under your visitor's thumb.`
      : `The page scores ${raw} on Google's layout-shift scale; a page is fully stable only below 0.10, and yours is above that, so things can still move under your visitor's thumb.`;
    out.push({
      kind: 'layout-shift',
      severity: clamp01(clsV / 60) + 0.02,
      status: clsStatus(clsV),
      headline: `The page <strong>jumps around</strong> as it loads`,
      note,
      chip: `layout jumps (${raw})`,
    });
  }
  if (fcp !== undefined && fcp > FCP_BLANK_MS) {
    out.push({
      kind: 'blank',
      severity: clamp01(fcp / 12000) + 0.1,
      status: 'poor',
      headline: `The screen stays <strong>blank for ${secs(fcp)}</strong>`,
      note: 'Nothing at all is painted to the screen for that long - it can read as a broken page.',
      chip: `blank for ${secs(fcp)}`,
    });
  } else if (fcp !== undefined && fcp > FCP_LATE_MS && (lcp === undefined || fcp > lcp - 500)) {
    out.push({
      kind: 'late-paint',
      severity: clamp01(fcp / 9000) * 0.85,
      status: 'fair',
      headline: `Nothing appears for the first <strong>${secs(fcp)}</strong>`,
      note: 'The first pixels take that long to land, so the page feels stalled at the start.',
      chip: `first paint ${secs(fcp)}`,
    });
  }
  if (tbt !== undefined && tbt > TBT_SLUGGISH_MS) {
    out.push({
      kind: 'sluggish',
      severity: clamp01(tbt / 1800) * 0.6,
      status: 'fair',
      headline: `The page is <strong>slow to react</strong> to taps`,
      note: 'For a stretch while it loads, taps and scrolls lag behind the finger.',
      chip: 'laggy to tap',
    });
  }

  out.sort((a, b) => b.severity - a.severity);
  if (out.length === 0) {
    const clean: Problem = {
      kind: 'clean',
      severity: 0,
      status: lcp !== undefined && lcp <= LCP_GOOD_MS ? 'good' : 'fair',
      headline: lcp !== undefined ? `Loads cleanly in <strong>${secs(lcp)}</strong>` : 'Loads cleanly',
      chip: 'clean',
    };
    return { lead: clean, rest: [] };
  }
  return { lead: out[0], rest: out.slice(1) };
}

export const PERF_PROBLEM_KINDS = ['slow-lcp', 'layout-shift', 'blank', 'late-paint', 'sluggish'] as const;
export type PerfProblemKind = typeof PERF_PROBLEM_KINDS[number];
export const PROBLEM_KINDS: ReadonlySet<ProblemKind> = new Set<ProblemKind>(PERF_PROBLEM_KINDS);

export interface PerfProblemTileCopy {
  kicker: string;
  wordTx: string;
  metricSub: (avgLabel: string | undefined) => string;
  conseq: string;
}

interface PerfProblemCopy extends PerfProblemTileCopy {
  phrase: (page: PagePerf) => string | undefined;
  metric: (page: PagePerf) => string | undefined;
}

const avgLcpSuffix = (avgLabel: string | undefined): string => avgLabel ? `; average LCP is ${avgLabel}` : '';
const metricSecs = (page: PagePerf, label: string): string | undefined => {
  const value = metricVal(page, label);
  return value === undefined ? undefined : secs(value);
};

const PERF_PROBLEM_COPY: Record<PerfProblemKind, PerfProblemCopy> = {
  'slow-lcp': {
    kicker: 'Mobile loading',
    wordTx: 'Main content is late',
    phrase: (page) => {
      const lcp = metricSecs(page, 'LCP');
      return lcp === undefined ? undefined : `biggest piece takes ${lcp} to load`;
    },
    metric: (page) => metricSecs(page, 'LCP'),
    metricSub: (avgLabel) => `worst page LCP${avgLcpSuffix(avgLabel)}`,
    conseq: 'The page starts, but the main content lands late enough that visitors may give up.',
  },
  'layout-shift': {
    kicker: 'Mobile stability',
    wordTx: 'Layout jumps',
    phrase: () => 'the layout jumps around',
    metric: (page) => {
      const clsV = metricVal(page, 'CLS');
      return clsV === undefined ? undefined : (clsV / 100).toFixed(2);
    },
    metricSub: (avgLabel) => `worst page layout-shift score${avgLcpSuffix(avgLabel)}`,
    conseq: 'Content moves while the page loads, so visitors can lose their place or tap the wrong thing.',
  },
  blank: {
    kicker: 'Mobile loading',
    wordTx: 'Blank screen first',
    phrase: (page) => {
      const fcp = metricSecs(page, 'FCP');
      return fcp === undefined ? undefined : `screen stays blank for ${fcp}`;
    },
    metric: (page) => metricSecs(page, 'FCP'),
    metricSub: (avgLabel) => `worst page first paint${avgLcpSuffix(avgLabel)}`,
    conseq: 'A visitor sees nothing at first, which can read as a broken page.',
  },
  'late-paint': {
    kicker: 'Mobile loading',
    wordTx: 'Slow first paint',
    phrase: (page) => {
      const fcp = metricSecs(page, 'FCP');
      return fcp === undefined ? undefined : `nothing appears for ${fcp}`;
    },
    metric: (page) => metricSecs(page, 'FCP'),
    metricSub: (avgLabel) => `worst page first paint${avgLcpSuffix(avgLabel)}`,
    conseq: 'The first pixels arrive late, so the page feels stalled before it starts.',
  },
  sluggish: {
    kicker: 'Mobile response',
    wordTx: 'Slow to react',
    phrase: () => 'slow to react to taps',
    metric: (page) => metricSecs(page, 'TBT'),
    metricSub: (avgLabel) => `worst page blocking time${avgLcpSuffix(avgLabel)}`,
    conseq: 'The page may look loaded, but taps and scrolls can lag behind the visitor.',
  },
};

function isPerfProblemKind(kind: ProblemKind): kind is PerfProblemKind {
  return PROBLEM_KINDS.has(kind);
}

export function perfProblemPhrase(lead: Problem, page: PagePerf): string | undefined {
  return isPerfProblemKind(lead.kind) ? PERF_PROBLEM_COPY[lead.kind].phrase(page) : undefined;
}

export function perfProblemMetric(lead: Problem, page: PagePerf): string | undefined {
  return isPerfProblemKind(lead.kind) ? PERF_PROBLEM_COPY[lead.kind].metric(page) : undefined;
}

export function perfProblemTileCopy(lead: Problem): PerfProblemTileCopy | undefined {
  if (!isPerfProblemKind(lead.kind)) return undefined;
  const copy = PERF_PROBLEM_COPY[lead.kind];
  return {
    kicker: copy.kicker,
    wordTx: copy.wordTx,
    metricSub: copy.metricSub,
    conseq: copy.conseq,
  };
}

export const V2_STATUS_RANK: Record<V2Status, number> = { good: 0, fair: 1, poor: 2 };

export interface V2PagePerfStatusInput {
  page: PagePerf;
  lead: Problem;
  rest?: readonly Problem[];
}

const V2_PROBLEM_STATUS: Record<PerfProblemKind, (page: PagePerf) => V2Status> = {
  'slow-lcp': (page) => v2LcpStatus(metricVal(page, 'LCP')),
  'layout-shift': (page) => v2ClsStatus(metricVal(page, 'CLS')),
  blank: (page) => v2FcpStatus(metricVal(page, 'FCP')),
  'late-paint': (page) => v2FcpStatus(metricVal(page, 'FCP')),
  sluggish: (page) => v2TbtStatus(metricVal(page, 'TBT')),
};

function worstV2Status(statuses: readonly V2Status[]): V2Status {
  return statuses.reduce<V2Status>(
    (worst, status) => V2_STATUS_RANK[status] > V2_STATUS_RANK[worst] ? status : worst,
    'good',
  );
}

function v2ProblemStatus(page: PagePerf, problem: Problem): V2Status {
  return isPerfProblemKind(problem.kind) ? V2_PROBLEM_STATUS[problem.kind](page) : problem.status;
}

export function v2PagePerfStatus(r: V2PagePerfStatusInput): V2Status {
  const problems = [r.lead, ...(r.rest ?? [])];
  const statuses = problems.map((problem) => v2ProblemStatus(r.page, problem));
  if (problems.some((problem) => problem.kind === 'slow-lcp')) {
    statuses.push(v2FcpStatus(metricVal(r.page, 'FCP')));
    statuses.push(v2ClsStatus(metricVal(r.page, 'CLS')));
    statuses.push(v2TbtStatus(metricVal(r.page, 'TBT')));
  }
  return worstV2Status(statuses);
}

export function v2PerfStatus(rows: readonly V2PagePerfStatusInput[], perfCouldNotMeasure = rows.length === 0): V2Status {
  if (perfCouldNotMeasure) return 'fair';
  return rows.reduce<V2Status>((worst, r) => {
    const status = v2PagePerfStatus(r);
    return V2_STATUS_RANK[status] > V2_STATUS_RANK[worst] ? status : worst;
  }, 'good');
}

export interface V2PerfProblemCandidate {
  page: PagePerf;
  problem: Problem;
  status: V2Status;
  severity: number;
}

function v2VirtualProblem(kind: PerfProblemKind, status: V2Status, severity: number, chip: string): Problem {
  return { kind, status, severity, headline: '', chip };
}

function v2RawMetricProblemCandidates(page: PagePerf, existingKinds: ReadonlySet<ProblemKind>): V2PerfProblemCandidate[] {
  const out: V2PerfProblemCandidate[] = [];
  const fcp = metricVal(page, 'FCP');
  const fcpStatus = v2FcpStatus(fcp);
  if (fcp !== undefined && fcpStatus !== 'good' && !existingKinds.has('blank') && !existingKinds.has('late-paint')) {
    out.push({
      page,
      problem: v2VirtualProblem('late-paint', fcpStatus, clamp01(fcp / 9000) * 0.85, `first paint ${secs(fcp)}`),
      status: fcpStatus,
      severity: clamp01(fcp / 9000) * 0.85,
    });
  }
  const clsV = metricVal(page, 'CLS');
  const clsStatusV = v2ClsStatus(clsV);
  if (clsV !== undefined && clsStatusV !== 'good' && !existingKinds.has('layout-shift')) {
    out.push({
      page,
      problem: v2VirtualProblem('layout-shift', clsStatusV, clamp01(clsV / 60) + 0.02, `layout jumps (${(clsV / 100).toFixed(2)})`),
      status: clsStatusV,
      severity: clamp01(clsV / 60) + 0.02,
    });
  }
  const tbt = metricVal(page, 'TBT');
  const tbtStatus = v2TbtStatus(tbt);
  if (tbt !== undefined && tbtStatus !== 'good' && !existingKinds.has('sluggish')) {
    out.push({
      page,
      problem: v2VirtualProblem('sluggish', tbtStatus, clamp01(tbt / 1800) * 0.6, 'laggy to tap'),
      status: tbtStatus,
      severity: clamp01(tbt / 1800) * 0.6,
    });
  }
  return out;
}

function v2PerfProblemCandidates(r: V2PagePerfStatusInput): V2PerfProblemCandidate[] {
  const problems = [r.lead, ...(r.rest ?? [])];
  const existingKinds = new Set(problems.map((problem) => problem.kind));
  const candidates = problems
    .filter((problem): problem is Problem & { kind: PerfProblemKind } => isPerfProblemKind(problem.kind))
    .map((problem) => ({
      page: r.page,
      problem,
      status: v2ProblemStatus(r.page, problem),
      severity: problem.severity,
    }));
  return existingKinds.has('slow-lcp')
    ? [...candidates, ...v2RawMetricProblemCandidates(r.page, existingKinds)]
    : candidates;
}

export function compareV2PerfProblemCandidate(a: V2PerfProblemCandidate, b: V2PerfProblemCandidate): number {
  const statusDelta = V2_STATUS_RANK[b.status] - V2_STATUS_RANK[a.status];
  if (statusDelta !== 0) return statusDelta;
  return b.severity - a.severity;
}

export function v2DominantPerfProblem(r: V2PagePerfStatusInput): V2PerfProblemCandidate | undefined {
  return v2PerfProblemCandidates(r)
    .filter((candidate) => candidate.status !== 'good')
    .sort(compareV2PerfProblemCandidate)[0];
}

export function comparePerfProblem<T extends V2PagePerfStatusInput>(a: T, b: T): number {
  const statusDelta = V2_STATUS_RANK[v2PagePerfStatus(b)] - V2_STATUS_RANK[v2PagePerfStatus(a)];
  if (statusDelta !== 0) return statusDelta;
  return (v2DominantPerfProblem(b)?.severity ?? b.lead.severity) - (v2DominantPerfProblem(a)?.severity ?? a.lead.severity);
}
