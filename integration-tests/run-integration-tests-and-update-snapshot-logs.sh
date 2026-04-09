#!/usr/bin/env bash
# Runs integration tests and updates the baseline log in-place.
# After running, use `git diff` to review changes to the baseline.
#
# Usage:
#   ./integration-tests/run-integration-tests-and-compare-logs.sh [--perf] [--visreg] [--twin-servers]
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

PERF=false
VISREG=false
TWIN_SERVERS=false
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --perf)         PERF=true ;;
    --visreg)       VISREG=true ;;
    --twin-servers) TWIN_SERVERS=true ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

# If no flags specified, run everything
if ! $PERF && ! $VISREG && ! $TWIN_SERVERS; then
  PERF=true; VISREG=true; TWIN_SERVERS=true
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

# Stop containers after all suites
echo "=== Stopping containers ==="
DEMO_CWD="/tmp/temp-shaka-perf-repos-for-tests/shaka-perf/demo-ecommerce"
(cd "$DEMO_CWD" && yarn shaka-perf twin-servers stop-containers) || true
