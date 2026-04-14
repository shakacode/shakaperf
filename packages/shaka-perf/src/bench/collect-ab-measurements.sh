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

for i in $(seq 1 "$N"); do
  echo "=== [$GROUP] run $i/$N: $* ==="
  "$@"
  if [ ! -f "$SRC_FILE" ]; then
    echo "ERROR: $SRC_FILE not found after run $i (cwd: $(pwd))" >&2
    exit 1
  fi
  cp "$SRC_FILE" "$OUT_DIR/ab-measurements-$i.json"
  echo "=== [$GROUP] saved $OUT_DIR/ab-measurements-$i.json ==="
done

printf '`%s` was run %s times\n' "$*" "$N" > "$OUT_DIR/summary.txt"

echo "Done. $N samples in $OUT_DIR"
