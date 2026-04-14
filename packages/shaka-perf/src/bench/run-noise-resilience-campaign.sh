#!/usr/bin/env bash
# Runs the full noise-resilience measurement campaign: 4 groups x N samples each.
# Groups:
#   noDifference_LowNoise    - control == experiment, no CPU noise
#   noDifference_HighNoise   - control == experiment, with random CPU noise
#   regression_LowNoise      - control vs ?hydration_delay=50, no CPU noise
#   regression_HighNoise     - control vs ?hydration_delay=50, with random CPU noise
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
COLLECT="$SCRIPT_DIR/collect-compare-samples.sh"
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

CMD_NODIFF=(yarn shaka-perf perf-compare \
  --controlURL http://localhost:3030/ \
  --experimentURL http://localhost:3030/ \
  --parallelism 2 -n 8 --filter Homepage)

CMD_REGRESSION=(yarn shaka-perf perf-compare \
  --controlURL http://localhost:3030/ \
  --experimentURL 'http://localhost:3030/?hydration_delay=50' \
  --parallelism 2 -n 8 --filter Homepage)

cd "$DEMO_DIR"

echo "============================================================"
echo "[campaign] group 1/4: noDifference_LowNoise (N=$N)"
echo "============================================================"
"$COLLECT" noDifference_LowNoise "$N" "${CMD_NODIFF[@]}"

echo "============================================================"
echo "[campaign] group 2/4: noDifference_HighNoise (N=$N)"
echo "============================================================"
start_noise
"$COLLECT" noDifference_HighNoise "$N" "${CMD_NODIFF[@]}"
stop_noise

echo "============================================================"
echo "[campaign] group 3/4: regression_LowNoise (N=$N)"
echo "============================================================"
"$COLLECT" regression_LowNoise "$N" "${CMD_REGRESSION[@]}"

echo "============================================================"
echo "[campaign] group 4/4: regression_HighNoise (N=$N)"
echo "============================================================"
start_noise
"$COLLECT" regression_HighNoise "$N" "${CMD_REGRESSION[@]}"
stop_noise

echo "[campaign] all 4 groups complete"
