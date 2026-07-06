#!/usr/bin/env bash
# Runs integration tests and updates the baseline log in-place.
# After running, use `git diff` to review changes to the baseline.
#
# Usage:
#   ./integration-tests/run-integration-tests-and-update-snapshot-logs.sh \
#       [--perf] [--visreg] [--twin-servers] [--audit]
#
# Snapshots contain ONLY reviewable, STABLE-NAMED artifacts — the normalized
# per-suite logs and the deep-click report screenshots, whose diffs come from
# compare-screenshots.mjs at review time. Nothing else is ever copied here:
# the reports are driven IN PLACE in the working results dirs (the temp
# clone's demo-ecommerce/{compare,audit}-results, where their relative
# artifact references resolve), which also keep the transient run output —
# report JSON/HTML, measurement dumps, videos, timeline frames, raw
# control/experiment/failed_diff captures with per-run ids in their
# filenames — until the next run for debugging. Layout under
# integration-tests/snapshots/:
#   - baseline-{perf,visreg,twin-servers,audit}.log
#                       — the normalized Playwright log per suite
#   - bench-results/report-shots/    — @perf deep-click screenshots
#   - visreg-results/report-shots/   — @visreg deep-click screenshots
#   - audit-results/report-shots/    — @audit deep-click screenshots
#       Taken by the specs while driving full-report.html (overview, filters,
#       artifact dialogs, visreg scrubbers, error-log dialogs) and, under
#       audit-results/, the v2 client-report states (status tiles, tab
#       panels, lightbox, severity chips). The overview shot is the
#       full-page render of the report — separate per-HTML screenshots would
#       only duplicate these dialog/overview shots (and the self-contained
#       report variant always duplicates the full report).
#
# The log output is automatically normalized to replace run-variable values
# (timestamps, timings, home directory paths, docker ages) with stubs.
#
# When reviewing the git diff, IGNORE differences in:
#   - Webpack hashes (e.g. -fa6c2b68881f0c7d1717)
#   - Git SHAs and visreg run-ids quoted inside the baseline logs
#   - Ordering of [CONTROL] vs [EXPERIMENT] lines (parallel execution)
#   - Asset sizes (e.g. "806 KiB") and module counts
#   - Byte-level noise in *.png — sub-pixel anti-aliasing and lazy-image
#     timing drift between runs; only care about gross layout breakage
#     (missing dialog, empty grid, blank iframe, missing tiles/tabs, etc.).
#     Review PNG changes through `yarn node
#     integration-tests/compare-screenshots.mjs`, not raw git diff.
#
# Focus on:
#   - Test pass/fail status
#   - Sequence of operations (>>> banners)
#   - Error messages or new warnings
#   - Missing or added steps
#   - Counts surfaced in the CLI's FAILED summary
#     (e.g. "1 perf regression, 3 visreg mismatches") — the compare CLI
#     exits non-zero when any test is errored / regressed / visually
#     changed, so "FAILED:" lines in the log are expected on runs that
#     still successfully produced the report. The @audit suite's all-pages
#     audit also expects one engine error (the sabotaged products selector).
#   - New/removed screenshots under the results dirs — a missing report-shot
#     means an interactive state stopped rendering.
#
# The `check-integration-tests-integrity` skill
# (.claude/commands/check-integration-tests-integrity.md) automates this
# review — it documents the per-log and per-screenshot expectations, and it
# also runs a timing comparison: two parallel subagents independently
# extract Playwright durations from the old baseline vs. the new log and
# return cross-checked slowdown verdicts (docker build / twins-build times
# excluded — layer-cache hit rate, not the code under test).

set -euo pipefail

PERF=false
VISREG=false
TWIN_SERVERS=false
AUDIT=false
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --perf)         PERF=true ;;
    --visreg)       VISREG=true ;;
    --twin-servers) TWIN_SERVERS=true ;;
    --audit)        AUDIT=true ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

# If no flags specified, run everything
if ! $PERF && ! $VISREG && ! $TWIN_SERVERS && ! $AUDIT; then
  PERF=true; VISREG=true; TWIN_SERVERS=true; AUDIT=true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOTS="$SCRIPT_DIR/snapshots"

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

echo "=== Cleaning previous snapshots ==="
mkdir -p "$SNAPSHOTS"
$PERF         && rm -rf "$SNAPSHOTS/baseline-perf.log" "$SNAPSHOTS/bench-results"
$VISREG       && rm -rf "$SNAPSHOTS/baseline-visreg.log" "$SNAPSHOTS/visreg-results"
$TWIN_SERVERS && rm -rf "$SNAPSHOTS/baseline-twin-servers.log"
$AUDIT        && rm -rf "$SNAPSHOTS/baseline-audit.log" "$SNAPSHOTS/audit-results"

# Ensure the Node version from .nvmrc is active (requires nvm to be loaded)
REQUIRED_NODE=$(cat "$REPO_ROOT/.nvmrc")
CURRENT_NODE=$(node -v 2>/dev/null | sed 's/^v//')
if [ "$CURRENT_NODE" != "$REQUIRED_NODE" ]; then
  echo "Node $REQUIRED_NODE required (currently $CURRENT_NODE). Running 'nvm use'..."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use || { echo "Failed to switch Node version. Run 'nvm install $REQUIRED_NODE' first."; exit 1; }
fi

run_suite() {
  local tag="$1" baseline="$2"
  local args=("${EXTRA_ARGS[@]}" --grep "$tag")
  if ! $SETUP_NEEDED; then
    export SKIP_GLOBAL_SETUP=1
  fi
  SETUP_NEEDED=false
  export SKIP_TEARDOWN=1
  echo "=== Running $tag tests ==="
  yarn test:integration "${args[@]}" 2>&1 | tee "$baseline"
  normalize_log "$baseline"
}

# Run each selected suite. First suite runs global setup; subsequent ones skip it.
SETUP_NEEDED=true
$TWIN_SERVERS && run_suite "@twin-servers" "$SNAPSHOTS/baseline-twin-servers.log"
$VISREG       && run_suite "@visreg"       "$SNAPSHOTS/baseline-visreg.log"
$PERF         && run_suite "@perf"         "$SNAPSHOTS/baseline-perf.log"
$AUDIT        && run_suite "@audit"        "$SNAPSHOTS/baseline-audit.log"

# Stop containers after all suites
echo "=== Stopping containers ==="
DEMO_CWD="/tmp/temp-shaka-perf-repos-for-tests/shaka-perf/demo-ecommerce"
(cd "$DEMO_CWD" && yarn shaka-perf servers stop-containers) || true
