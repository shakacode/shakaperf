#!/usr/bin/env bash
# Runs the full noise-resilience measurement campaign.
# Groups (4 sampling conditions x 2 outcomes x 2 noise = 16):
#   Sampling conditions:
#     seq1  - --sampling-mode sequential   --parallelism 1  (pre-PR behavior)
#     seqP  - --sampling-mode sequential   --parallelism 4  (pairs drift between workers)
#     sim1  - --sampling-mode simultaneous --parallelism 1  (pair-coupling without parallelism)
#     simP  - --sampling-mode simultaneous --parallelism 4  (current PR default)
#   Outcomes:
#     noDifference  - control == experiment
#     regression    - control vs ?hydration_delay=50
#   Noise:
#     LowNoise      - no additional CPU noise
#     HighNoise     - synthetic CPU noise generator running in parallel
#
# Prereqs:
#   - twin-servers up (localhost:3030 reachable)
#   - `yarn build` has produced dist/bench/random-cpu-noise-generator.js
#
# Usage (from anywhere):
#   packages/shaka-perf/src/bench/run-noise-resilience-campaign.sh [N]
# Defaults to N=20.

set -euo pipefail

N="${1:-20}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(cd "$PKG_DIR/../.." && pwd)"
DEMO_DIR="$REPO_DIR/demo-ecommerce"
COLLECT="$SCRIPT_DIR/collect-ab-measurements.sh"
NOISE_JS="$PKG_DIR/dist/bench/random-cpu-noise-generator.js"

if [ ! -f "$NOISE_JS" ]; then
  echo "ERROR: $NOISE_JS not found. Run \`yarn build\` first." >&2
  exit 1
fi
if [ ! -d "$DEMO_DIR" ]; then
  echo "ERROR: $DEMO_DIR not found." >&2
  exit 1
fi

NOISE_PID=""

stop_noise() {
  if [ -n "$NOISE_PID" ] && kill -0 "$NOISE_PID" 2>/dev/null; then
    echo "[campaign] stopping noise generator (pid=$NOISE_PID)"
    kill -TERM "$NOISE_PID" 2>/dev/null || true
    wait "$NOISE_PID" 2>/dev/null || true
  fi
  NOISE_PID=""
}

trap stop_noise EXIT INT TERM

start_noise() {
  echo "[campaign] starting noise generator"
  node "$NOISE_JS" &
  NOISE_PID=$!
  echo "[campaign] noise generator pid=$NOISE_PID"
}

# (tag, sampling-mode, parallelism)
CONDITIONS=(
  "seq1 sequential 1"
  "seqP sequential 4"
  "sim1 simultaneous 1"
  "simP simultaneous 4"
)

cd "$DEMO_DIR"

group_idx=0
total_groups=$((${#CONDITIONS[@]} * 4))

for cond in "${CONDITIONS[@]}"; do
  read -r TAG MODE PAR <<< "$cond"

  CMD_NODIFF=(yarn shaka-perf perf-compare \
    --controlURL http://localhost:3030/ \
    --experimentURL http://localhost:3030/ \
    --sampling-mode "$MODE" --parallelism "$PAR" -n 8 --filter Homepage)

  CMD_REGRESSION=(yarn shaka-perf perf-compare \
    --controlURL http://localhost:3030/ \
    --experimentURL 'http://localhost:3030/?hydration_delay=50' \
    --sampling-mode "$MODE" --parallelism "$PAR" -n 8 --filter Homepage)

  for OUTCOME in noDifference regression; do
    for NOISE in LowNoise HighNoise; do
      group_idx=$((group_idx + 1))
      GROUP="${OUTCOME}_${NOISE}_${TAG}"
      echo "============================================================"
      echo "[campaign] group ${group_idx}/${total_groups}: ${GROUP} (N=$N)"
      echo "============================================================"
      if [ "$NOISE" = "HighNoise" ]; then
        start_noise
      fi
      if [ "$OUTCOME" = "regression" ]; then
        "$COLLECT" "$GROUP" "$N" "${CMD_REGRESSION[@]}"
      else
        "$COLLECT" "$GROUP" "$N" "${CMD_NODIFF[@]}"
      fi
      if [ "$NOISE" = "HighNoise" ]; then
        stop_noise
      fi
    done
  done
done

echo "[campaign] all ${total_groups} groups complete"
