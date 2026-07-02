# Statistical Methods Used by `shaka-perf`

This document explains the statistical approach used by `perf-compare` and `perf-analyze` to decide whether an experiment is faster, slower, or indistinguishable from control. It's intended to justify the choices rather than teach statistics from scratch — the goal is that anyone reviewing a shaka-perf result can trust it.

## The problem we're solving

Local-machine frontend perf benchmarks are dominated by **system noise** — CPU scheduling jitter, thermal throttling, background processes, GC pauses, disk caches warming up, browser-internal timing variance. A single measurement is essentially meaningless; a naive "run N times and average" approach demands enormous N to distinguish a real sub-millisecond regression from noise.

Rather than fighting noise by averaging it out, we **align the noise** between control and experiment and then **subtract it** via paired statistics.

## The two pillars

### 1. Simultaneous, noise-aligned sampling

Each iteration runs control and experiment **in parallel** (`Promise.all`), so both sides are exposed to the same instant of CPU contention, thermal state, and background-task interference. Whatever noise hits at iteration `i` hits both groups.

**Shuffle is preserved** inside each iteration to prevent systematic scheduling bias (the first one scheduled tends to get a faster core / fewer preemptions). Shuffle averages out the ordering effect; simultaneity preserves the shared-noise effect.

This produces truly paired samples: `(control[i], experiment[i])` share a noise moment and differ primarily by the code change under test.

### 2. Paired non-parametric statistics

All three outputs — significance, point estimate, confidence interval — operate on the per-index paired differences `d[i] = control[i] − experiment[i]`.

#### Significance: Wilcoxon Signed-Rank test

We use a port of SciPy's `scipy.stats.wilcoxon(method='auto')`:

- **Exact null distribution** for `n ≤ 50` when there are no ties. The null distribution of `W+` (sum of positive ranks) is computed via the recursion from SciPy's `_get_wilcoxon_distr`: each rank `k ∈ {1, …, n}` is independently + or − with probability 0.5, convolving contributions into the PMF.
- **Normal approximation** with continuity correction and tie correction for larger `n` or when ties are present.
- Zeros are discarded (Wilcoxon's reduced-sample convention).

Why the exact path matters: the normal approximation is systematically conservative at small `n`. At `n=8`, for example, the approximation floors the minimum achievable two-sided p-value at ~0.014, meaning even a perfect all-same-sign sweep cannot clear a `pValueThreshold` of 0.01. The exact p-value for that sweep is `2/2⁸ ≈ 0.0078`, which does clear it. Without the exact path, small-n runs would miss real regressions.

#### Point estimate: paired Hodges-Lehmann

The median of all Walsh averages `{(d[i] + d[j]) / 2 : i ≤ j}` — the Hodges-Lehmann estimator that corresponds to the Wilcoxon Signed-Rank test. Robust to within-group outliers because the pairing cancels shared noise before the median is taken.

#### Confidence interval: Walsh-averages bounds

The lower and upper bounds of the CI are the sorted Walsh averages at the rank given by the signed-rank critical value (exact-PMF lookup for `n ≤ 50`, normal approximation otherwise). By construction the CI excludes zero iff the signed-rank test rejects `H₀` at the same level — the p-value and the CI bounds are guaranteed consistent.

## Why not the standard alternatives?

| Approach | Problem in our setting |
|---|---|
| Mean + Welch's t-test | Assumes normality; latency distributions are skewed and heavy-tailed. Means are sensitive to outliers, of which Lighthouse produces many. |
| Mann-Whitney U (unpaired) | Treats the samples as independent groups. Throws away pairing information even when it exists. A single within-group outlier contaminates the Cartesian product of differences and can hide a real regression. |
| Bootstrap on the mean | More flexible, but still mean-sensitive and doesn't naturally exploit pairing unless specifically implemented. |
| Paired t-test | Exploits pairing, but assumes paired differences are normally distributed. Lighthouse diffs are not. |
| Wilcoxon Signed-Rank (our choice) | Exploits pairing, no distributional assumptions on the diffs, robust to outliers, and has a known exact null distribution for small n. |

## Why not the TracerBench approach we forked from?

TracerBench (and the earlier versions of this codebase) used Mann-Whitney U + unpaired Hodges-Lehmann. That's a sensible choice when you cannot collect paired measurements. Once we moved to simultaneous noise-aligned sampling, the pairing information became valuable, and using an unpaired test left statistical power on the table — especially for short benchmark runs (`n` in the 8–20 range, which is common during development).

## Thresholds and decision rules

- `--pValueThreshold` (default **0.01**) — the significance level `α` against which the Wilcoxon p-value is compared. The confidence interval is computed at `1 − α`.
- `--regressionThreshold` (default **50 ms**) — absolute magnitude required to treat a significant result as a regression worth alerting on. Noise is one thing; moving a metric by 50 ms is another.
- Practical-significance floor: the reporter hides significant results with `|HL estimator| < 1 ms` to avoid cluttering output with mathematically-significant-but-operationally-meaningless deltas.

## Limitations and honest caveats

- **Pairing assumes the two sides share noise.** If, due to process isolation or scheduling quirks, control and experiment end up on independent CPU contention regimes, paired statistics gives no power advantage over unpaired. The simultaneous-sampling implementation is designed to maximise shared noise, but it's not a formal guarantee.
- **The normal approximation is conservative at small n.** We use the exact distribution for `n ≤ 50` to avoid this, but for `n > 50` small effects can still be under-reported. This is standard and matches SciPy.
- **Ties are assumed rare.** With microsecond-precision Lighthouse timings this is almost always true; when ties do occur we fall back to the asymptotic path with tie correction applied to the variance.
