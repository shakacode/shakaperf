#!/usr/bin/env bash
# Runs integration tests and updates the baseline log in-place.
# After running, use `git diff` to review changes to the baseline.
#
# Usage:
#   ./integration-tests/run-integration-tests-and-compare-logs.sh
#
# The output is automatically normalized to replace run-variable values
# (timestamps, timings, home directory paths, docker ages) with stubs.
#
# When reviewing the git diff, IGNORE differences in:
#   - Webpack hashes (e.g. -fa6c2b68881f0c7d1717)
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
BASELINE="$SCRIPT_DIR/baseline-output.log"

# Replace values that change between runs with stable stubs.
# Uses POSIX BRE and > tmp + mv for macOS/Linux portability.
normalize_log() {
  local file="$1"
  sed \
    -e 's|/Users/[^/]*/|/home/<USER>/|g' \
    -e 's|/home/[^/]*/|/home/<USER>/|g' \
    -e 's|\[20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]* #[0-9]*\]|[<TIMESTAMP> #<PID>]|g' \
    -e 's/Completed in [0-9]*s [0-9]*ms/Completed in <TIMING>/g' \
    -e 's/Done with warnings in [0-9]*s [0-9]*ms/Done with warnings in <TIMING>/g' \
    -e 's/Done in [0-9]*s [0-9]*ms/Done in <TIMING>/g' \
    -e 's/in [0-9][0-9]* ms/in <TIMING> ms/g' \
    -e 's/in [0-9]*\.[0-9]*s (/in <TIMING>s (/g' \
    -e 's/([0-9]*\.[0-9]*s)/(<TIMING>s)/g' \
    -e 's/([0-9]*\.[0-9]*m)/(<TIMING>m)/g' \
    -e 's/[0-9]* seconds ago/<DOCKER_AGE>/g' \
    -e 's/About a minute ago/<DOCKER_AGE>/g' \
    -e 's/Up [0-9]* seconds/Up <DOCKER_UPTIME>/g' \
    -e 's/\x1b\[[0-9;]*m//g' \
    "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

cd "$REPO_ROOT"

echo "=== Running integration tests ==="
# Strip ANSI codes so the output is readable in plain text
yarn test:integration 2>&1 | tee "$BASELINE"

# Normalize variable values in the saved output (not in the terminal output)
normalize_log "$BASELINE"

echo ""
echo "Baseline updated: $BASELINE"
echo "Review changes:   git diff integration-tests/baseline-output.log"
