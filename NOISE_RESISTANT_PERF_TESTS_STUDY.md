# Noise-Resistant Perf Tests — Experiment Study

Does switching from Mann-Whitney U to paired Wilcoxon **and**
paired-simultaneous sampling actually make perf-tests noise-resilient,
or is one of the two pieces doing all the work? Run the campaign, diff
the summaries, check if all predictions hold.

## Test-quality metrics

1. **False-regression count** in `noDifference_*` groups — lower is better.
2. **Mean p-value (detected)** in `regression_*` groups — lower is better.

Both land in `testData/SUMMARY.md` via the `perf-noise-summary` skill.

## Sampling conditions

Full 2×2 grid (sampling-mode × parallelism):

|              | par=1 | par=3 |
| ------------ | ----- | ----- |
| sequential   | seq1  | seqP  |
| simultaneous | sim1  | simP  |

- **seq1** — `--sampling-mode sequential --parallelism 1` (pre-PR)
- **seqP** — `--sampling-mode sequential --parallelism 3` (parallelism, no pair-coupling)
- **sim1** — `--sampling-mode simultaneous --parallelism 1` (pair-coupling, no parallelism)
- **simP** — `--sampling-mode simultaneous --parallelism 3` (current default)

## 16 campaign groups

| Group                          | Sampling     | Par | Noise  | Control URL              | Experiment URL                              |
| ------------------------------ | ------------ | :-: | ------ | ------------------------ | ------------------------------------------- |
| `noDifference_LowNoise_seq1`   | sequential   |  1  | off    | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_LowNoise_seqP`   | sequential   |  3  | off    | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_LowNoise_simP`   | simultaneous |  3  | off    | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_HighNoise_seq1`  | sequential   |  1  | **on** | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_HighNoise_seqP`  | sequential   |  3  | **on** | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_HighNoise_simP`  | simultaneous |  3  | **on** | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_LowNoise_sim1`   | simultaneous |  1  | off    | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `noDifference_HighNoise_sim1`  | simultaneous |  1  | **on** | `http://localhost:3030/` | `http://localhost:3030/`                    |
| `regression_LowNoise_seq1`     | sequential   |  1  | off    | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_LowNoise_seqP`     | sequential   |  3  | off    | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_LowNoise_simP`     | simultaneous |  3  | off    | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_HighNoise_seq1`    | sequential   |  1  | **on** | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_HighNoise_seqP`    | sequential   |  3  | **on** | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_HighNoise_simP`    | simultaneous |  3  | **on** | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_LowNoise_sim1`     | simultaneous |  1  | off    | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |
| `regression_HighNoise_sim1`    | simultaneous |  1  | **on** | `http://localhost:3030/` | `http://localhost:3030/?hydration_delay=50` |

20 runs per group. Detection metric: `hydration-start`.

## Stats methods

- **NEW** (current, `5da18f5`): paired Wilcoxon Signed-Rank on
  `d_i = experiment[i] − control[i]`; Hodges-Lehmann point estimate =
  median of Walsh averages `(d_i + d_j) / 2`.
- **OLD** (pre-`5da18f5`): unpaired Mann-Whitney U via normal
  approximation; two-sample Hodges-Lehmann = median of the `n × n`
  cartesian differences `control[i] − experiment[j]`.

NEW exploits pairing (shared noise cancels in each `d_i`) but
misbehaves when pairs drift; OLD can't exploit pairing at all but is
drift-immune. Same `--pValueThreshold 0.01` gates significance in both,
held constant for the study.

## Predictions
This is written before te measurements, to check if my understanding is correct.
The main thing is I expect smaller p-values under noise for paired tests, but only whein sampling is simultaneous.

- **Q1.** HighNoise, regression, NEW: `simP` vs `seq1` mean p-value. Direction?
  simP should outperform seq1 by a huge margin. The regression will be detected more frequently and with orders of magnitude smaller p-value.
- **Q2.** HighNoise, regression, NEW: `simP` vs `seqP`.
  same as Q1. simP should outperform seqP
- **Q3.** HighNoise, regression, NEW: `sim1` vs `seq1`.
  sim1 should drastically outperform seq1
- **Q4.** HighNoise, regression, NEW: `sim1` vs `simP`.
  roughly same performance expected
- **Q5.** HighNoise, noDifference, NEW: does `seqP` produce more false regressions than `seq1`/`sim1`/`simP`?
  No difference actually. p-value threshould 0.01 should reduce false regressions to absolute minimum.
- **Q6 (control).** LowNoise.
  NEW stats: All four sampling conditions should be indistinguishable in terms of true and false regressions.
  OLD stats: sim1 (the best) == seq1 > simP > seqP (the worst)
- **Q7.** HighNoise, regression, `simP`: NEW vs OLD mean p-value. Does paired stats help when pairs are locked?
  NEW should outperform OLD by a huge margin. In NEW the regression will be detected more frequently and with orders of magnitude smaller p-value.
- **Q8.** HighNoise, regression, `seqP`: NEW vs OLD. Paired stats should lose the edge (or lose) when pairs drift.
  No difference in performance. Both should perform badly.
- **Q9 (synthesis).** Bigger swing in mean p-value: (seq1→simP at NEW) or (OLD→NEW at simP)?
  Depends on noise. On low noise, seq1 shoul de same as simP at NEW, however adding noise makes simP way better.
  Switching OLD→NEW at simP gives way better results at high noise, but still benefitial at low noise


## Procedure

### 1. Run the campaign (~4 hrs, quiet machine)

```bash
cd demo-ecommerce
yarn shaka-perf twins-build   # if needed
yarn shaka-perf twins-start
yarn build
../packages/shaka-perf/src/bench/run-noise-resilience-campaign.sh 20
```

Outputs land in `packages/shaka-perf/src/bench/testData/<group>/`. Don't
use the machine during the run.

### 2. Generate NEW-stats summary; commit

```bash
cd packages/shaka-perf
UPDATE_TESTDATA=1 yarn jest noise-resilience
```

Run the `perf-noise-summary` skill, then commit `testData/`.

### 3. Revert stats to OLD

```bash
git show 5da18f5 --stat
git checkout 5da18f5^ -- packages/shaka-perf/src/bench/stats \
                         packages/shaka-perf/src/bench/cli/compare/generate-stats.ts \
                         packages/shaka-perf/src/bench/cli/compare/compare-results.ts
yarn build
```

Do not revert sampling-mode, parallelism, process-isolation, or campaign-script commits.
Only revert canges in statistical methods.

### 4. Regenerate OLD-stats summary (no remeasurement)

```bash
cd packages/shaka-perf
UPDATE_TESTDATA=1 yarn jest noise-resilience
```

Run the `perf-noise-summary` skill again.

### 5. Diff

```bash
git diff HEAD -- packages/shaka-perf/src/bench/testData/SUMMARY.md
git diff HEAD -- packages/shaka-perf/src/bench/testData
```

### 6. Check predictions Q1–Q9. Notice where your answers were wrong


