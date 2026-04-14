import jStat = require('jstat');

// Average-rank ties: indices [i..j) in the sorted array all get rank (i+1+j)/2.
function averageRanks(sortedAbs: number[]): number[] {
  const n = sortedAbs.length;
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sortedAbs[j] === sortedAbs[i]) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = avg;
    i = j;
  }
  return ranks;
}

/**
 * Exact PMF of the Wilcoxon Signed-Rank W+ statistic under the null
 * (each of the n ranks equally likely to be + or -). Returns an array of
 * length n*(n+1)/2 + 1 where entry k is P(W+ = k).
 *
 * Port of SciPy's `_get_wilcoxon_distr` (scipy.stats._hypotests). Builds
 * the distribution by convolving in rank k at each step: the sign of k
 * is + (contributes k) or - (contributes 0), each with probability 0.5.
 */
function wilcoxonSignedRankPMF(n: number): number[] {
  let c: number[] = [1];
  for (let k = 1; k <= n; k++) {
    const prev = c;
    const size = (k * (k + 1)) / 2 + 1;
    c = new Array<number>(size).fill(0);
    for (let j = 0; j < prev.length; j++) {
      c[j] += prev[j] * 0.5;
      c[j + k] += prev[j] * 0.5;
    }
  }
  return c;
}

// Two-sided exact p-value from the PMF of W+. Matches SciPy's convention:
//   p = 2 * min(sf(floor(W+)), cdf(ceil(W+))), clipped to [0, 1].
function exactTwoSidedPValue(wPlus: number, pmf: number[]): number {
  const maxK = pmf.length - 1;
  const floor = Math.floor(wPlus);
  const ceil = Math.ceil(wPlus);
  let sf = 0;
  for (let i = floor; i <= maxK; i++) sf += pmf[i];
  let cdf = 0;
  for (let i = 0; i <= ceil; i++) cdf += pmf[i];
  return Math.min(1, 2 * Math.min(sf, cdf));
}

/**
 * Two-tailed p-value for the Wilcoxon Signed-Rank test on paired samples.
 *
 * Mirrors SciPy's `stats.wilcoxon(..., method='auto')`:
 *   - Zero differences are discarded (Wilcoxon's reduced-sample convention).
 *   - When no ties and n <= 50, use the *exact* null distribution.
 *   - Otherwise, use the normal approximation with continuity correction
 *     and tie correction to the variance.
 */
export function wilcoxonSignedRankPValue(
  control: number[],
  experiment: number[]
): number {
  if (control.length !== experiment.length) {
    throw new Error(
      `Wilcoxon Signed-Rank requires paired samples of equal length (got ${control.length} vs ${experiment.length})`
    );
  }

  const diffs: number[] = [];
  for (let i = 0; i < control.length; i++) {
    const d = control[i] - experiment[i];
    if (d !== 0) diffs.push(d);
  }
  const n = diffs.length;
  if (n === 0) return 1;

  const sorted = diffs.slice().sort((a, b) => Math.abs(a) - Math.abs(b));
  const absSorted = sorted.map((d) => Math.abs(d));
  const ranks = averageRanks(absSorted);

  let wPlus = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i] > 0) wPlus += ranks[i];
  }

  // Detect ties in absolute-difference magnitudes.
  let hasTies = false;
  for (let i = 1; i < n; i++) {
    if (absSorted[i] === absSorted[i - 1]) {
      hasTies = true;
      break;
    }
  }

  // Exact path: no ties and n small enough that the O(n^3) PMF build is cheap.
  // SciPy's auto-switch threshold is n > 50; we match it.
  if (!hasTies && n <= 50) {
    return exactTwoSidedPValue(wPlus, wilcoxonSignedRankPMF(n));
  }

  // Asymptotic path: normal approximation with continuity + tie correction.
  const mean = (n * (n + 1)) / 4;

  let tieCorrection = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && absSorted[j] === absSorted[i]) j++;
    const t = j - i;
    if (t > 1) tieCorrection += (t * t * t - t) / 48;
    i = j;
  }
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection;
  if (variance <= 0) return 1;
  const sd = Math.sqrt(variance);

  const continuity = wPlus > mean ? -0.5 : wPlus < mean ? 0.5 : 0;
  const z = (wPlus - mean + continuity) / sd;

  return jStat.normal.cdf(-Math.abs(z), 0, 1) * 2;
}
