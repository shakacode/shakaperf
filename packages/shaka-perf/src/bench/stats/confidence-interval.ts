import jStat = require('jstat');

import { toNearestHundreth } from './utils';
import { wilcoxonSignedRankPMF } from './wilcoxon-signed-rank';

export interface PairedCIInputs {
  n: number;
  sortedWalsh: number[];
  pmf: number[] | null; // exact PMF when n ≤ 50, null otherwise (asymptotic)
  controlMedian: number;
}

/**
 * Precompute the sorted Walsh averages of the paired differences and the
 * exact W+ PMF (for small n). The confidence interval at any level can then
 * be derived in O(1) lookups plus O(pmf) critical-rank search.
 */
export function preparePairedCIInputs(
  control: number[],
  experiment: number[]
): PairedCIInputs {
  if (control.length !== experiment.length) {
    throw new Error(
      `Paired CI requires equal-length arrays (got ${control.length} vs ${experiment.length})`
    );
  }
  const n = control.length;

  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i++) diffs[i] = control[i] - experiment[i];

  const walshLen = (n * (n + 1)) / 2;
  const walsh = new Array<number>(walshLen);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      walsh[idx++] = (diffs[i] + diffs[j]) / 2;
    }
  }
  walsh.sort((a, b) => a - b);

  const pmf = n > 0 && n <= 50 ? wilcoxonSignedRankPMF(n) : null;

  const sc = control.slice().sort((a, b) => a - b);
  const m = sc.length;
  const controlMedian =
    m === 0 ? 0 : m % 2 === 1 ? sc[(m - 1) / 2] : (sc[m / 2 - 1] + sc[m / 2]) / 2;

  return { n, sortedWalsh: walsh, pmf, controlMedian };
}

/**
 * Largest integer c such that P(W+ ≤ c) ≤ alpha/2. Returns -1 if no such
 * integer exists (i.e. the requested confidence level is not achievable at
 * this n), in which case the CI spans the full Walsh range.
 */
function criticalRank(n: number, alpha: number, pmf: number[] | null): number {
  const halfAlpha = alpha / 2;
  if (pmf !== null) {
    let cdf = 0;
    let c = -1;
    for (let k = 0; k < pmf.length; k++) {
      if (cdf + pmf[k] > halfAlpha) break;
      cdf += pmf[k];
      c = k;
    }
    return c;
  }
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  // continuity correction: P(W+ ≤ c) ≈ Φ((c + 0.5 − mean)/sd)
  return Math.floor(jStat.normal.inv(halfAlpha, mean, sd) - 0.5);
}

export interface IPairedCI {
  min: number;
  median: number;
  max: number;
  asPercent: { percentMin: number; percentMedian: number; percentMax: number };
}

/**
 * Two-sided confidence interval for the median paired difference, and the
 * paired Hodges-Lehmann point estimate (median of Walsh averages). Matches
 * the Wilcoxon Signed-Rank test used for significance, so the CI excludes
 * zero iff the signed-rank test rejects H0 at the same level.
 */
export function pairedConfidenceInterval(
  inputs: PairedCIInputs,
  confidence: number
): IPairedCI {
  const { n, sortedWalsh, pmf, controlMedian } = inputs;
  const N = sortedWalsh.length;

  let estimator = 0;
  if (N > 0) {
    estimator =
      N % 2 === 1
        ? sortedWalsh[(N - 1) / 2]
        : (sortedWalsh[N / 2 - 1] + sortedWalsh[N / 2]) / 2;
  }

  const alpha = 1 - confidence;
  const c = criticalRank(n, alpha, pmf);

  let ciLow: number;
  let ciHigh: number;
  if (N === 0) {
    ciLow = 0;
    ciHigh = 0;
  } else if (c < 0 || c >= N) {
    // confidence level not achievable at this n — fall back to full Walsh range
    ciLow = sortedWalsh[0];
    ciHigh = sortedWalsh[N - 1];
  } else {
    ciLow = sortedWalsh[c];
    ciHigh = sortedWalsh[N - 1 - c];
  }

  const denom = controlMedian === 0 ? 1 : controlMedian;
  return {
    min: ciLow,
    max: ciHigh,
    median: estimator,
    asPercent: {
      percentMin: toNearestHundreth((ciLow / denom) * 100),
      percentMedian: toNearestHundreth((estimator / denom) * 100),
      percentMax: toNearestHundreth((ciHigh / denom) * 100)
    }
  };
}
