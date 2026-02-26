#!/usr/bin/env bash
# Runs integration tests and saves output for comparison against the baseline.
#
# Usage:
#   ./integration-tests/run-and-validate.sh
#
# After running, compare the output against the baseline:
#   diff integration-tests/baseline-output.log /tmp/integration-test-output.log
#
# When comparing, IGNORE differences in:
#   - Timestamps (e.g. 2026-02-26T07:20:41.058020)
#   - Webpack hashes (e.g. -fa6c2b68881f0c7d1717)
#   - Timing/duration values (e.g. "45.9s", "in 14041 ms", "6 seconds ago")
#   - Git SHAs
#   - Ordering of [CONTROL] vs [EXPERIMENT] lines (parallel execution)
#   - Asset sizes (e.g. "806 KiB")
#   - Module counts
#
# Focus on:
#   - Test pass/fail status
#   - Sequence of operations (>>> banners)
#   - Error messages or new warnings
#   - Missing or added steps

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="/tmp/integration-test-output.log"

cd "$REPO_ROOT"

echo "=== Running integration tests ==="
# Strip ANSI codes so the output is readable in plain text
yarn test:integration 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee "$OUTPUT"

echo ""
echo "Output saved to: $OUTPUT"
echo "Baseline is at:  $SCRIPT_DIR/baseline-output.log"
echo ""
echo "Compare with:    diff integration-tests/baseline-output.log $OUTPUT"
