#!/usr/bin/env bash
# Runs a perf-test command N times and archives each ab-measurements.json into
# packages/shaka-perf/src/bench/testData/<group>/ab-measurements-<N>.json
#
# Usage:
#   collect-ab-measurements.sh <group> <n> <cmd...>
#
# Example (run from demo-ecommerce):
#   ../packages/shaka-perf/src/bench/collect-ab-measurements.sh noDifference 30 \
#     yarn shaka-perf perf-compare --iterations 10

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <group> <n> <cmd...>" >&2
  exit 1
fi

GROUP="$1"
N="$2"
shift 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/testData/$GROUP"
SRC_FILE="tracerbench-results/homepage/ab-measurements.json"

mkdir -p "$OUT_DIR"

DURATIONS_FILE="$OUT_DIR/durations.json"
ENTRIES=()

for i in $(seq 1 "$N"); do
  echo "=== [$GROUP] run $i/$N: $* ==="
  run_start=$SECONDS
  "$@"
  run_duration=$(( SECONDS - run_start ))
  if [ ! -f "$SRC_FILE" ]; then
    echo "ERROR: $SRC_FILE not found after run $i (cwd: $(pwd))" >&2
    exit 1
  fi
  cp "$SRC_FILE" "$OUT_DIR/ab-measurements-$i.json"
  echo "=== [$GROUP] saved $OUT_DIR/ab-measurements-$i.json (${run_duration}s) ==="
  ENTRIES+=("  \"$i\": $run_duration")
done

# Write durations.json with a clean (comma-separated, no trailing comma) body.
# Avoids `sed -i` portability differences between BSD (macOS) and GNU sed.
{
  echo "{"
  for idx in "${!ENTRIES[@]}"; do
    if [ "$idx" -lt "$(( ${#ENTRIES[@]} - 1 ))" ]; then
      echo "${ENTRIES[$idx]},"
    else
      echo "${ENTRIES[$idx]}"
    fi
  done
  echo "}"
} > "$DURATIONS_FILE"


echo "Done. $N samples in $OUT_DIR"
