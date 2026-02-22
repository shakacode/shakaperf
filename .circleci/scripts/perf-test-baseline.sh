#!/usr/bin/env bash
#
# Manages the perf test baseline commit SHA in S3.
#
# The baseline is a single text file in S3 containing the 40-character SHA
# of the last commit where perf tests passed on the main branch.
#
# Usage:
#   perf-test-baseline.sh download          Download baseline SHA, set $PERF_BASELINE_SHA
#   perf-test-baseline.sh upload            Upload current HEAD as new baseline
#   perf-test-baseline.sh commits           List commits since baseline
#   perf-test-baseline.sh ack-instructions  Print acknowledgement instructions
#
# Environment variables:
#   S3_BUCKET           S3 bucket name (default: shaka-perf-demo-storage)
#   S3_ENDPOINT         Custom S3 endpoint for R2 etc. (optional)
#   AWS_ACCESS_KEY_ID   AWS credentials
#   AWS_SECRET_ACCESS_KEY

set -euo pipefail

BUCKET="${S3_BUCKET:-shaka-perf-demo-storage}"
S3_KEY="perf-test-baseline/demo-ecommerce"
S3_URI="s3://${BUCKET}/${S3_KEY}"

aws_cmd() {
  if [ -n "${S3_ENDPOINT:-}" ]; then
    aws s3 --endpoint-url "$S3_ENDPOINT" "$@"
  else
    aws s3 "$@"
  fi
}

cmd_download() {
  local tmp_file
  tmp_file=$(mktemp)

  echo "Downloading perf test baseline from ${S3_URI}..."

  if aws_cmd cp "$S3_URI" "$tmp_file" 2>/dev/null; then
    local sha
    sha=$(tr -d '[:space:]' < "$tmp_file")
    rm -f "$tmp_file"

    # Validate it looks like a SHA
    if ! echo "$sha" | grep -qE '^[0-9a-f]{40}$'; then
      echo "Warning: Invalid baseline SHA format: '$sha'"
      echo "Falling back to HEAD~1"
      sha=$(git rev-parse HEAD~1)
    fi

    # Validate the commit exists in the repo
    if ! git cat-file -t "$sha" >/dev/null 2>&1; then
      echo "Warning: Baseline commit $sha not found in git history"
      echo "Falling back to HEAD~1"
      sha=$(git rev-parse HEAD~1)
    fi

    echo "Perf test baseline SHA: ${sha:0:7} ($sha)"
    echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
  else
    rm -f "$tmp_file"
    echo "Warning: No perf test baseline found in S3. This appears to be the first run."
    echo "Falling back to HEAD~1 as initial baseline."
    local sha
    sha=$(git rev-parse HEAD~1)
    echo "Using fallback baseline SHA: ${sha:0:7} ($sha)"
    echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
  fi
}

cmd_upload() {
  local sha
  sha=$(git rev-parse HEAD)

  echo "Uploading perf test baseline to ${S3_URI}..."
  echo -n "$sha" | aws_cmd cp - "$S3_URI"
  echo "Perf test baseline updated to: ${sha:0:7} ($sha)"
}

cmd_commits() {
  # Source BASH_ENV to get PERF_BASELINE_SHA if set by a prior step
  if [ -f "$BASH_ENV" ]; then
    # shellcheck disable=SC1090
    source "$BASH_ENV"
  fi

  if [ -z "${PERF_BASELINE_SHA:-}" ]; then
    echo "Error: PERF_BASELINE_SHA is not set. Run 'download' first."
    exit 1
  fi

  local current_sha
  current_sha=$(git rev-parse HEAD)

  echo "=== Commits since baseline ==="
  echo "Baseline: ${PERF_BASELINE_SHA:0:7} ($PERF_BASELINE_SHA)"
  echo "Current:  ${current_sha:0:7} ($current_sha)"
  echo ""

  local commit_list
  commit_list=$(git log --first-parent --oneline "${PERF_BASELINE_SHA}..HEAD")
  local count
  count=$(echo "$commit_list" | grep -c . || true)

  if [ "$count" -eq 0 ]; then
    echo "No commits found between baseline and HEAD."
  else
    echo "$count commit(s) since baseline:"
    echo ""
    echo "$commit_list"
  fi
}

cmd_ack_instructions() {
  local current_sha
  current_sha=$(git rev-parse HEAD)

  echo ""
  echo "=== Perf Test Regression Acknowledgement ==="
  echo ""
  echo "The performance tests detected a regression compared to the baseline."
  echo ""
  echo "To investigate, review the commits listed above and the test artifacts."
  echo ""
  echo "To acknowledge this regression and update the baseline to ${current_sha:0:7}:"
  echo ""
  echo "  Option 1: Trigger the pipeline via CircleCI UI or API with update-perf-baseline=true"
  echo ""
  echo "    curl -X POST https://circleci.com/api/v2/project/gh/shakacode/shaka-perf/pipeline \\"
  echo "      -H 'Circle-Token: \$CIRCLECI_TOKEN' -H 'content-type: application/json' \\"
  echo "      -d '{\"branch\": \"main\", \"parameters\": {\"update-perf-baseline\": true}}'"
  echo ""
  echo "  Option 2: Use the AWS CLI directly"
  echo ""
  echo "    echo -n '$current_sha' | aws s3 cp - $S3_URI"
  echo ""
}

case "${1:-}" in
  download)
    cmd_download
    ;;
  upload)
    cmd_upload
    ;;
  commits)
    cmd_commits
    ;;
  ack-instructions)
    cmd_ack_instructions
    ;;
  *)
    echo "Usage: perf-test-baseline.sh <download|upload|commits|ack-instructions>"
    exit 1
    ;;
esac
