/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportStatus } from '../client-report-renderer';
import { perfHeadline } from '../cost-strings';
import type { PagePerf } from '../synthesis';

const LCP_GOOD_MS = 2500;
const LCP_SLOW_MS = 10000;
export const LCP_WAIT_MS = 4000; // a visitor notices the wait above this
const REPORT_LCP_ACCEPTABLE_MS = 4000;
const REPORT_FCP_GOOD_MS = 1800;
const REPORT_FCP_POOR_MS = 3000;
const REPORT_TBT_GOOD_MS = 200;
const REPORT_TBT_POOR_MS = 600;
export const CLS_GOOD = 10;
const CLS_POOR = 25;
const FCP_BLANK_MS = 8000; // nothing painted for this long = effectively blank
const FCP_LATE_MS = 3500; // first paint noticeably late
const TBT_SLUGGISH_MS = 600;
const SCORE_GOOD = 90;
const SCORE_POOR = 50;
export const VISIBLE_SHIFT = 0.02;

export type Status = 'good' | 'fair' | 'poor';

/** C score badges always use a score's own Lighthouse band, never tab status. */
export type ScoreBadgePolicy = 'score-status';
export const SCORE_BADGE_POLICY: ScoreBadgePolicy = 'score-status';

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

export function reportLcpStatus(ms: number | undefined): ClientReportStatus {
  if (ms === undefined) return 'fair';
  if (ms <= REPORT_LCP_ACCEPTABLE_MS) return 'good';
  if (ms <= LCP_SLOW_MS) return 'fair';
  return 'poor';
}

export function reportFcpStatus(ms: number | undefined): ClientReportStatus {
  if (ms === undefined) return 'good';
  if (ms <= REPORT_FCP_GOOD_MS) return 'good';
  if (ms <= REPORT_FCP_POOR_MS) return 'fair';
  return 'poor';
}

export function reportClsStatus(v: number | undefined): ClientReportStatus {
  return clsStatus(v);
}

export function reportTbtStatus(ms: number | undefined): ClientReportStatus {
  if (ms === undefined) return 'good';
  if (ms <= REPORT_TBT_GOOD_MS) return 'good';
  if (ms <= REPORT_TBT_POOR_MS) return 'fair';
  return 'poor';
}

export function scoreStatus(score: number | undefined): Status {
  if (score === undefined) return 'fair';
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_POOR) return 'fair';
  return 'poor';
}

/** Kept as a named renderer seam so the badge policy cannot drift to tab status. */
export function scoreBadgeStatus(score: number | undefined): Status {
  return scoreStatus(score);
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
  benchmarkTx?: string;
  benchmarkHtml?: string;
  metricSub: (avgLabel: string | undefined) => string;
  conseq: string;
}

interface PerfProblemCopy extends PerfProblemTileCopy {
  phrase: (page: PagePerf) => string | undefined;
  metric: (page: PagePerf) => string | undefined;
}

const avgLcpSuffix = (avgLabel: string | undefined): string => avgLabel ? `; average LCP is ${avgLabel}` : '';
const CLS_BENCHMARK_TX = 'Google target: 0.10 or less; poor over 0.25.';
const CLS_BENCHMARK_HTML = 'Google target: <span style="color:#2f7d4f; font-weight:700">0.10</span> or less; poor over <span style="color:#c0271f; font-weight:700">0.25</span>.';
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
    benchmarkTx: CLS_BENCHMARK_TX,
    benchmarkHtml: CLS_BENCHMARK_HTML,
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

export function isPerfCostProblem(problem: Problem): problem is Problem & { kind: PerfProblemKind } {
  return isPerfProblemKind(problem.kind);
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
    ...(copy.benchmarkTx ? { benchmarkTx: copy.benchmarkTx } : {}),
    ...(copy.benchmarkHtml ? { benchmarkHtml: copy.benchmarkHtml } : {}),
    metricSub: copy.metricSub,
    conseq: copy.conseq,
  };
}

const PERF_COST_HEADLINE: Record<PerfProblemKind, (label: string, phrase: string | undefined, pageName: string) => string> = {
  'slow-lcp': (label, _phrase, pageName) => perfHeadline(label, pageName),
  'layout-shift': (_label, phrase) => `${phrase ?? 'the layout jumps around'} on a mid-range phone`,
  blank: (_label, phrase) => `${phrase ?? 'the screen stays blank'} on a mid-range phone`,
  'late-paint': (_label, phrase) => `${phrase ?? 'nothing appears at first'} on a mid-range phone`,
  sluggish: (_label, phrase) => `${phrase ?? 'the page is slow to react to taps'} on a mid-range phone`,
};

const PERF_AFFECTS_PROSE: Record<PerfProblemKind, string> = {
  'slow-lcp': 'Slow main content makes mobile visitors wait and give up before they reach the contact or booking form.',
  'layout-shift': 'Layout shifts make the page feel unstable: content and controls move while visitors are reading or trying to tap.',
  blank: 'A blank start leaves visitors with no useful feedback and can make the page feel broken before anything appears.',
  'late-paint': 'Late first paint delays the first visible feedback, so visitors spend the start of the visit looking at an empty screen.',
  sluggish: 'Slow tap response makes the page feel stuck while visitors try to scroll, open menus, or get in touch.',
};

const PERF_COPY_PROMPT_KINDS: ReadonlySet<ProblemKind> = new Set(['slow-lcp']);

export function perfCostHeadline(problem: Problem & { kind: PerfProblemKind }, label: string, phrase: string | undefined, page: PagePerf): string {
  const pageName = page.name || page.startingPath || 'this page';
  return PERF_COST_HEADLINE[problem.kind](label, phrase, pageName);
}

export function perfAffectsProse(problem: Problem & { kind: PerfProblemKind }): string {
  return PERF_AFFECTS_PROSE[problem.kind];
}

export function perfCostCopyPromptEnabled(problem: Problem): boolean {
  return PERF_COPY_PROMPT_KINDS.has(problem.kind);
}

export const CLIENT_REPORT_STATUS_RANK: Record<ClientReportStatus, number> = { good: 0, fair: 1, poor: 2 };

export interface ClientReportPagePerfStatusInput {
  page: PagePerf;
  lead: Problem;
  rest?: readonly Problem[];
}

const CLIENT_REPORT_PROBLEM_STATUS: Record<PerfProblemKind, (page: PagePerf) => ClientReportStatus> = {
  'slow-lcp': (page) => reportLcpStatus(metricVal(page, 'LCP')),
  'layout-shift': (page) => reportClsStatus(metricVal(page, 'CLS')),
  blank: (page) => reportFcpStatus(metricVal(page, 'FCP')),
  'late-paint': (page) => reportFcpStatus(metricVal(page, 'FCP')),
  sluggish: (page) => reportTbtStatus(metricVal(page, 'TBT')),
};

function worstClientReportStatus(statuses: readonly ClientReportStatus[]): ClientReportStatus {
  return statuses.reduce<ClientReportStatus>(
    (worst, status) => CLIENT_REPORT_STATUS_RANK[status] > CLIENT_REPORT_STATUS_RANK[worst] ? status : worst,
    'good',
  );
}

function reportProblemStatus(page: PagePerf, problem: Problem): ClientReportStatus {
  return isPerfProblemKind(problem.kind) ? CLIENT_REPORT_PROBLEM_STATUS[problem.kind](page) : problem.status;
}

export function reportPagePerfStatus(r: ClientReportPagePerfStatusInput): ClientReportStatus {
  const problems = [r.lead, ...(r.rest ?? [])];
  const statuses = problems.map((problem) => reportProblemStatus(r.page, problem));
  if (problems.some((problem) => problem.kind === 'slow-lcp')) {
    statuses.push(reportFcpStatus(metricVal(r.page, 'FCP')));
    statuses.push(reportClsStatus(metricVal(r.page, 'CLS')));
    statuses.push(reportTbtStatus(metricVal(r.page, 'TBT')));
  }
  return worstClientReportStatus(statuses);
}

export function reportPerfStatus(rows: readonly ClientReportPagePerfStatusInput[], perfCouldNotMeasure = rows.length === 0): ClientReportStatus {
  if (perfCouldNotMeasure) return 'fair';
  return rows.reduce<ClientReportStatus>((worst, r) => {
    const status = reportPagePerfStatus(r);
    return CLIENT_REPORT_STATUS_RANK[status] > CLIENT_REPORT_STATUS_RANK[worst] ? status : worst;
  }, 'good');
}

export interface ClientReportPerfProblemCandidate {
  page: PagePerf;
  problem: Problem;
  status: ClientReportStatus;
  severity: number;
}

function reportVirtualProblem(kind: PerfProblemKind, status: ClientReportStatus, severity: number, chip: string): Problem {
  return { kind, status, severity, headline: '', chip };
}

function rawMetricProblemCandidates(page: PagePerf, existingKinds: ReadonlySet<ProblemKind>): ClientReportPerfProblemCandidate[] {
  const out: ClientReportPerfProblemCandidate[] = [];
  const fcp = metricVal(page, 'FCP');
  const fcpStatus = reportFcpStatus(fcp);
  if (fcp !== undefined && fcpStatus !== 'good' && !existingKinds.has('blank') && !existingKinds.has('late-paint')) {
    out.push({
      page,
      problem: reportVirtualProblem('late-paint', fcpStatus, clamp01(fcp / 9000) * 0.85, `first paint ${secs(fcp)}`),
      status: fcpStatus,
      severity: clamp01(fcp / 9000) * 0.85,
    });
  }
  const clsV = metricVal(page, 'CLS');
  const clsStatusV = reportClsStatus(clsV);
  if (clsV !== undefined && clsStatusV !== 'good' && !existingKinds.has('layout-shift')) {
    out.push({
      page,
      problem: reportVirtualProblem('layout-shift', clsStatusV, clamp01(clsV / 60) + 0.02, `layout jumps (${(clsV / 100).toFixed(2)})`),
      status: clsStatusV,
      severity: clamp01(clsV / 60) + 0.02,
    });
  }
  const tbt = metricVal(page, 'TBT');
  const tbtStatus = reportTbtStatus(tbt);
  if (tbt !== undefined && tbtStatus !== 'good' && !existingKinds.has('sluggish')) {
    out.push({
      page,
      problem: reportVirtualProblem('sluggish', tbtStatus, clamp01(tbt / 1800) * 0.6, 'laggy to tap'),
      status: tbtStatus,
      severity: clamp01(tbt / 1800) * 0.6,
    });
  }
  return out;
}

function perfProblemCandidates(r: ClientReportPagePerfStatusInput): ClientReportPerfProblemCandidate[] {
  const problems = [r.lead, ...(r.rest ?? [])];
  const existingKinds = new Set(problems.map((problem) => problem.kind));
  const candidates = problems
    .filter((problem): problem is Problem & { kind: PerfProblemKind } => isPerfProblemKind(problem.kind))
    .map((problem) => ({
      page: r.page,
      problem,
      status: reportProblemStatus(r.page, problem),
      severity: problem.severity,
    }));
  return existingKinds.has('slow-lcp')
    ? [...candidates, ...rawMetricProblemCandidates(r.page, existingKinds)]
    : candidates;
}

export function compareClientReportPerfProblemCandidate(a: ClientReportPerfProblemCandidate, b: ClientReportPerfProblemCandidate): number {
  const statusDelta = CLIENT_REPORT_STATUS_RANK[b.status] - CLIENT_REPORT_STATUS_RANK[a.status];
  if (statusDelta !== 0) return statusDelta;
  return b.severity - a.severity;
}

export function selectPerfCostAnchor(
  candidates: readonly ClientReportPerfProblemCandidate[],
  lcpGoodMs: number,
): ClientReportPerfProblemCandidate | undefined {
  const homepage = candidates.find((candidate) =>
    candidate.page.startingPath === '/' && (metricVal(candidate.page, 'LCP') ?? 0) > lcpGoodMs,
  );
  return homepage ?? candidates[0];
}

export function dominantPerfProblem(r: ClientReportPagePerfStatusInput): ClientReportPerfProblemCandidate | undefined {
  return perfProblemCandidates(r)
    .filter((candidate) => candidate.status !== 'good')
    .sort(compareClientReportPerfProblemCandidate)[0];
}

export function comparePerfProblem<T extends ClientReportPagePerfStatusInput>(a: T, b: T): number {
  const statusDelta = CLIENT_REPORT_STATUS_RANK[reportPagePerfStatus(b)] - CLIENT_REPORT_STATUS_RANK[reportPagePerfStatus(a)];
  if (statusDelta !== 0) return statusDelta;
  return (dominantPerfProblem(b)?.severity ?? b.lead.severity) - (dominantPerfProblem(a)?.severity ?? a.lead.severity);
}
